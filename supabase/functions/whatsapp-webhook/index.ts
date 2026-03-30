import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Config ──────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN")!;
const WAPI_BASE = "https://gate.whapi.cloud";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Working hours per weekday (matches src/lib/workingHours.ts)
// Mo-Do: 8.5h, Fr: 5.0h (inkl. 0.5h ZA-Überstunde), Sa-So: 0h
function getRegelarbeitszeit(date: Date = new Date()): number {
  const day = date.getDay();
  if (day === 0 || day === 6) return 0;    // Weekend
  if (day >= 1 && day <= 4) return 8.5;    // Mo-Do
  if (day === 5) return 5.0;              // Fr (inkl. 0.5h Überstunde)
  return 0;
}

// ─── Types ───────────────────────────────────────────────

interface ConversationEntry {
  role: "user" | "assistant" | "system";
  content: string;
}

// ─── WAPI helpers ────────────────────────────────────────

async function sendWhatsApp(to: string, message: string) {
  const recipient = to.includes("@") ? to : `${to}@s.whatsapp.net`;
  const res = await fetch(`${WAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WAPI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: recipient, body: message }),
  });
  const result = await res.json();
  if (!res.ok) console.error("WAPI send error:", result);
  return result;
}

async function downloadMedia(mediaUrl: string): Promise<ArrayBuffer> {
  console.log("Downloading media:", mediaUrl);

  if (!mediaUrl.startsWith("http")) {
    const apiUrl = `${WAPI_BASE}/media/${mediaUrl}`;
    const res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
    });
    if (!res.ok) throw new Error(`WAPI media failed (${res.status})`);
    return res.arrayBuffer();
  }

  let res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
  });
  if (!res.ok) res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`Media download failed (${res.status})`);
  return res.arrayBuffer();
}

// ─── Speech-to-Text via OpenAI Whisper ───────────────────

async function transcribeAudio(audioUrl: string): Promise<string> {
  console.log("Transcribing audio:", audioUrl);

  const audioBuffer = await downloadMedia(audioUrl);
  const blob = new Blob([audioBuffer], { type: "audio/ogg" });

  const formData = new FormData();
  formData.append("file", blob, "voice.ogg");
  formData.append("model", "whisper-1");
  formData.append("language", "de");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: formData,
  });

  const result = await res.json();

  if (!res.ok) {
    console.error("Whisper error:", result);
    throw new Error("Spracherkennung fehlgeschlagen");
  }

  console.log("Transcribed:", result.text);
  return result.text;
}

// ─── Employee lookup ─────────────────────────────────────

async function findEmployeeByPhone(phone: string) {
  const cleaned = phone
    .replace("@s.whatsapp.net", "")
    .replace(/[\s\-\+\(\)]/g, "")
    .replace(/^0+/, "");
  const last8 = cleaned.slice(-8);

  const { data } = await supabase
    .from("employees")
    .select("id, vorname, nachname, user_id, telefon, whatsapp_aktiv")
    .or(`telefon.ilike.%${last8}%`)
    .limit(1)
    .maybeSingle();

  return data;
}

// ─── Conversation persistence ────────────────────────────

async function loadHistory(phone: string, limit = 12): Promise<ConversationEntry[]> {
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("direction, message_body")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];
  return data
    .reverse()
    .filter((m) => m.message_body)
    .map((m) => ({
      role: m.direction === "incoming" ? ("user" as const) : ("assistant" as const),
      content: m.message_body!,
    }));
}

async function saveMsg(
  phone: string,
  direction: "incoming" | "outgoing",
  body: string,
  employeeId?: string,
  userId?: string
) {
  await supabase.from("whatsapp_messages").insert({
    phone,
    direction,
    message_body: body,
    message_type: "text",
    employee_id: employeeId || null,
    user_id: userId || null,
    processed: true,
  });
}

// ─── Rich context ────────────────────────────────────────

async function gatherContext(userId: string) {
  const today = new Date().toISOString().split("T")[0];
  const dayNames = [
    "Sonntag", "Montag", "Dienstag", "Mittwoch",
    "Donnerstag", "Freitag", "Samstag",
  ];
  const dayName = dayNames[new Date().getDay()];

  const [projectsRes, todayEntriesRes, assignmentsRes, recentEntriesRes] =
    await Promise.all([
      supabase.from("projects").select("id, name").eq("status", "aktiv").order("name"),
      supabase.from("time_entries")
        .select("id, stunden, taetigkeit, project_id, projects(name), created_at")
        .eq("user_id", userId).eq("datum", today)
        .order("created_at", { ascending: false }),
      supabase.from("worker_assignments")
        .select("project_id, projects(name)")
        .eq("worker_id", userId).eq("date", today),
      supabase.from("time_entries")
        .select("datum, stunden, taetigkeit, projects(name)")
        .eq("user_id", userId).order("datum", { ascending: false }).limit(7),
    ]);

  const projects = projectsRes.data || [];
  const todayEntries = todayEntriesRes.data || [];
  const assignments = (assignmentsRes.data || []) as any[];
  const recentEntries = (recentEntriesRes.data || []) as any[];

  const todayHours = todayEntries.reduce(
    (sum: number, e: any) => sum + (e.stunden || 0), 0
  );
  const dailyTarget = getRegelarbeitszeit();
  const remainingHours = Math.max(0, dailyTarget - todayHours);

  let ctx = `DATUM HEUTE: ${today} (${dayName})\n`;
  ctx += `REGELARBEITSZEIT HEUTE: ${dailyTarget}h (${dayName === "Freitag" ? "Freitag = kuerzerer Tag" : "Mo-Do"})\n`;
  ctx += `HEUTE BEREITS GEBUCHT: ${todayHours}h\n`;
  ctx += `NOCH OFFEN HEUTE: ${remainingHours}h\n`;

  if (todayEntries.length > 0) {
    ctx += `\nHEUTIGE BUCHUNGEN:\n`;
    todayEntries.forEach((e: any) => {
      ctx += `  • ${e.stunden}h → ${e.projects?.name || "?"} – ${e.taetigkeit || "k.A."}\n`;
    });
  }

  if (assignments.length > 0) {
    ctx += `\nPLANTAFEL-EINTEILUNG HEUTE:\n`;
    assignments.forEach((a: any) => {
      ctx += `  • ${a.projects?.name || "?"}\n`;
    });
  }

  if (recentEntries.length > 0) {
    ctx += `\nLETZTE BUCHUNGEN:\n`;
    recentEntries.slice(0, 5).forEach((e: any) => {
      ctx += `  • ${e.datum}: ${e.stunden}h → ${e.projects?.name || "?"} (${e.taetigkeit || ""})\n`;
    });
  }

  ctx += `\nAKTIVE PROJEKTE (nummeriert):\n`;
  projects.forEach((p: any, i: number) => {
    ctx += `  ${i + 1}. ${p.name}  [ID: ${p.id}]\n`;
  });

  return { context: ctx, projects, todayHours, remainingHours, dailyTarget, todayEntries };
}

// ─── OpenAI Tool definitions ─────────────────────────────

const tools = [
  {
    type: "function" as const,
    function: {
      name: "stunden_buchen",
      description:
        "Bucht Arbeitsstunden auf ein Projekt. WICHTIG: Pruefe vorher im Kontext wie viele Stunden heute schon gebucht sind. Die Summe aller Buchungen darf die Regelarbeitszeit (8h) nicht ueberschreiten.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "UUID des Projekts" },
          stunden: { type: "number", description: "Stundenanzahl" },
          taetigkeit: { type: "string", description: "Beschreibung der Taetigkeit" },
          datum: { type: "string", description: "Datum YYYY-MM-DD, Standard = heute" },
          start_time: { type: "string", description: "Startzeit HH:MM (optional)" },
          end_time: { type: "string", description: "Endzeit HH:MM (optional)" },
        },
        required: ["project_id", "stunden", "taetigkeit", "datum"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "foto_hochladen",
      description: "Laedt ein empfangenes Foto auf ein Projekt hoch.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "UUID des Projekts" },
          beschreibung: { type: "string", description: "Beschreibung des Fotos" },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "letzte_buchung_loeschen",
      description: "Loescht die letzte Stundenbuchung des heutigen Tages.",
      parameters: {
        type: "object",
        properties: {
          grund: { type: "string", description: "Warum wird geloescht" },
        },
        required: ["grund"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "projekte_anzeigen",
      description: "Zeigt die nummerierte Liste aller aktiven Projekte.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ─── Tool execution ──────────────────────────────────────

async function executeTool(
  name: string,
  input: any,
  userId: string,
  senderName: string,
  mediaRef?: string,
  cachedImageBuffer?: ArrayBuffer | null
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

  switch (name) {
    case "stunden_buchen": {
      const h = input.stunden;
      const datum = input.datum || today;

      if (h <= 0 || h > 24)
        return "FEHLER: Stunden muessen zwischen 0.25 und 24 liegen.";

      // Check total hours for this day
      const { data: existingEntries } = await supabase
        .from("time_entries")
        .select("stunden")
        .eq("user_id", userId)
        .eq("datum", datum);

      const alreadyBooked = (existingEntries || []).reduce(
        (sum: number, e: any) => sum + (e.stunden || 0), 0
      );
      const totalAfter = alreadyBooked + h;

      const bookingDate = new Date(datum + "T12:00:00");
      const dailyTarget = getRegelarbeitszeit(bookingDate);

      if (totalAfter > dailyTarget + 2) {
        return `FEHLER: Bereits ${alreadyBooked}h gebucht fuer ${datum}. Mit ${h}h waeren es ${totalAfter}h – das ueberschreitet die Regelarbeitszeit (${dailyTarget}h) deutlich. Bitte pruefe die Stunden.`;
      }

      const startTime = input.start_time || "07:00";
      let endTime = input.end_time;
      if (!endTime) {
        const startMins = parseInt(startTime.split(":")[0]) * 60 + parseInt(startTime.split(":")[1] || "0");
        const totalMins = startMins + h * 60 + (h > 6 ? 30 : 0);
        endTime = `${String(Math.floor(totalMins / 60)).padStart(2, "0")}:${String(Math.round(totalMins % 60)).padStart(2, "0")}`;
      }

      const { error } = await supabase.from("time_entries").insert({
        user_id: userId,
        datum,
        stunden: h,
        taetigkeit: input.taetigkeit,
        project_id: input.project_id,
        location_type: "baustelle",
        start_time: startTime,
        end_time: endTime,
        pause_minutes: h > 6 ? 30 : 0,
      });

      if (error) return `FEHLER: ${error.message}`;

      const { data: proj } = await supabase
        .from("projects").select("name").eq("id", input.project_id).maybeSingle();

      const remaining = dailyTarget - totalAfter;
      let result = `ERFOLG: ${h}h auf "${proj?.name}" am ${datum} gebucht. Taetigkeit: ${input.taetigkeit}. Tagesgesamt: ${totalAfter}h von ${dailyTarget}h.`;
      if (remaining > 0.25) {
        result += ` HINWEIS: Noch ${remaining}h offen fuer heute (Soll: ${dailyTarget}h).`;
      } else if (remaining >= 0) {
        result += ` Tagessoll erreicht ✓`;
      }
      return result;
    }

    case "foto_hochladen": {
      if (!cachedImageBuffer) return "FEHLER: Kein Foto vorhanden.";
      try {
        const buf = cachedImageBuffer;
        const ts = Date.now();
        const fileName = `${input.project_id}/whatsapp_${ts}.jpg`;

        const { error: upErr } = await supabase.storage
          .from("project-photos")
          .upload(fileName, buf, { contentType: "image/jpeg", upsert: false });
        if (upErr) throw upErr;

        const { data: urlData } = supabase.storage
          .from("project-photos").getPublicUrl(fileName);

        const { error: docErr } = await supabase.from("documents").insert({
          name: `WhatsApp Foto – ${senderName} – ${new Date().toLocaleDateString("de-AT")}`,
          file_url: urlData.publicUrl,
          typ: "foto",
          beschreibung: input.beschreibung || `WhatsApp-Upload von ${senderName}`,
          project_id: input.project_id,
          user_id: userId,
        });
        if (docErr) console.error("Doc insert error:", docErr);

        const { data: proj } = await supabase
          .from("projects").select("name").eq("id", input.project_id).maybeSingle();

        return `ERFOLG: Foto auf Projekt "${proj?.name}" hochgeladen.`;
      } catch (e: any) {
        console.error("Photo upload error:", e);
        return `FEHLER: ${e.message}`;
      }
    }

    case "letzte_buchung_loeschen": {
      const { data: last } = await supabase
        .from("time_entries")
        .select("id, stunden, taetigkeit, projects(name)")
        .eq("user_id", userId).eq("datum", today)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();

      if (!last) return "FEHLER: Heute keine Buchungen vorhanden.";

      const { error } = await supabase.from("time_entries").delete().eq("id", last.id);
      if (error) return `FEHLER: ${error.message}`;

      return `ERFOLG: Buchung geloescht (${last.stunden}h auf ${(last as any).projects?.name}: ${last.taetigkeit}).`;
    }

    case "projekte_anzeigen": {
      const { data: projects } = await supabase
        .from("projects").select("id, name").eq("status", "aktiv").order("name");

      if (!projects?.length) return "Keine aktiven Projekte.";
      return "AKTIVE PROJEKTE:\n" + projects.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
    }

    default:
      return `FEHLER: Unbekanntes Tool ${name}`;
  }
}

// ─── OpenAI conversation ─────────────────────────────────

async function askGPT(
  systemPrompt: string,
  history: ConversationEntry[],
  userMessage: string,
  userId: string,
  senderName: string,
  mediaRef?: string,
  cachedImageBuffer?: ArrayBuffer | null
): Promise<string> {
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const callGPT = async (msgs: any[]) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: msgs, tools, max_tokens: 1024 }),
    });
    return res.json();
  };

  let result = await callGPT(messages);
  let rounds = 0;

  while (result.choices?.[0]?.finish_reason === "tool_calls" && rounds < 5) {
    rounds++;
    const msg = result.choices[0].message;
    messages.push(msg);

    for (const tc of msg.tool_calls || []) {
      const args = JSON.parse(tc.function.arguments);
      const output = await executeTool(tc.function.name, args, userId, senderName, mediaRef, cachedImageBuffer);
      messages.push({ role: "tool", tool_call_id: tc.id, content: output });
    }

    result = await callGPT(messages);
  }

  return result.choices?.[0]?.message?.content || "Entschuldigung, da ist etwas schiefgelaufen.";
}

// ─── System prompt ───────────────────────────────────────

function buildSystemPrompt(
  senderName: string,
  ctx: string,
  todayHours: number,
  remainingHours: number,
  dailyTarget: number
): string {
  return `Du bist der *eBauer Assistent* – der WhatsApp-Helfer der eBauer GmbH (Elektrofirma).
Sei freundlich, locker, hilfreich – aber kurz und knapp (WhatsApp!).
WhatsApp-Formatierung: *fett*, _kursiv_. Emojis sparsam.

MITARBEITER: ${senderName}
${ctx}

═══ ARBEITSZEIT-REGELN (STRIKT!) ═══

ARBEITSZEITEN DER FIRMA:
• Montag–Donnerstag: 8,5h (07:00–16:00, 30min Mittagspause)
• Freitag: 5,0h (07:00–12:30, inkl. 0,5h ZA-Ueberstunde)
• Samstag/Sonntag: frei
• Wochensoll: 39 Stunden

HEUTE: ${dailyTarget}h Tagessoll. Gebucht: ${todayHours}h. Offen: ${remainingHours}h.

REGELN:
1. Die Summe aller Buchungen pro Tag darf das Tagessoll NICHT ueberschreiten (max. 1-2h Ueberstunden in Ausnahmen, NUR wenn ausdruecklich bestaetigt).
2. NACH JEDER BUCHUNG: Wenn noch Reststunden offen sind → SOFORT nachfragen:
   "Du hast noch Xh offen. Was hast du da gemacht?"
   Schlage Projekte aus der Plantafel oder den letzten Buchungen vor.
3. Wenn Mitarbeiter z.B. nur 4h bucht → buche die 4h, dann frag DIREKT nach den restlichen Stunden.
4. Wenn jemand MEHR als das Tagessoll buchen will → warnen und nur buchen wenn bestaetigt.
5. Am Wochenende: keine Buchungen ohne ausdruecklichen Grund.

═══ STUNDENBUCHUNG ═══

- Projekt + Stunden klar → direkt buchen
- Projekt unklar → nummerierte Liste zeigen, "Antworte mit der Nummer"
- Nur "Stunden schreiben" → Frag Stunden + zeige Projekte
- Nur Stunden ohne Projekt → Plantafel pruefen, sonst fragen
- Nummern-Antwort → Projekt aus letzter Liste nehmen
- Taetigkeit fehlt → kurz nachfragen

═══ SPRACHNACHRICHTEN ═══
- Sprachnachrichten werden automatisch in Text umgewandelt.
- Der transkribierte Text kann Fehler enthalten – interpretiere sinnvoll.
- Wenn unklar, frag kurz nach.

═══ FOTOS ═══
- Foto mit Beschreibung → Projekt zuordnen
- Foto ohne → nach Projekt fragen

═══ KORREKTUREN ═══
- "Stimmt nicht" / "Loesch das" → letzte_buchung_loeschen

═══ EINTEILUNG ═══
- "Wo muss ich hin?" → Plantafel zeigen

═══ ALLGEMEINE REGELN ═══
- IMMER Deutsch
- Kurz und knapp!
- Nach Buchung: Bestaetigung mit ✓ + Tagesgesamt + Reststunden
- Niemals UUIDs oder technische Details zeigen
- Nummern-Antworten beziehen sich auf die letzte Projektliste
- Du bist Zeiterfassungs-Assistent, kein allgemeiner Chatbot`;
}

// ─── Parse WAPI webhook ──────────────────────────────────

interface ParsedMsg {
  from: string;
  body?: string;
  type: string;
  mediaUrl?: string;
  audioUrl?: string;
  caption?: string;
}

function parseWapiPayload(payload: any): ParsedMsg[] {
  const msgs: ParsedMsg[] = [];
  const messageList = payload.messages || [];

  for (const m of messageList) {
    const from = (m.from || m.chat_id || "").replace("@s.whatsapp.net", "");
    if (!from || m.from_me) continue;

    const parsed: ParsedMsg = { from, type: m.type || "text" };

    if (m.type === "text" || (!m.type && m.text)) {
      parsed.body = m.text?.body || m.body || m.text;
    } else if (m.type === "image") {
      parsed.mediaUrl = m.image?.link || m.image?.url || m.image?.id;
      parsed.caption = m.image?.caption;
      console.log("Image payload:", JSON.stringify(m.image));
    } else if (m.type === "document") {
      parsed.caption = m.document?.filename || m.document?.caption;
    } else if (m.type === "voice" || m.type === "audio" || m.type === "ptt") {
      // Voice messages → will be transcribed
      parsed.audioUrl = m.audio?.link || m.audio?.url || m.audio?.id
        || m.voice?.link || m.voice?.url || m.voice?.id
        || m.ptt?.link || m.ptt?.url || m.ptt?.id;
      console.log("Audio payload:", JSON.stringify(m.audio || m.voice || m.ptt));
    } else if (m.type === "video") {
      parsed.mediaUrl = m.video?.link || m.video?.url;
      parsed.caption = m.video?.caption;
    }

    if (!parsed.body && !parsed.mediaUrl && !parsed.audioUrl && m.body) {
      parsed.body = m.body;
    }

    msgs.push(parsed);
  }

  return msgs;
}

// ─── Main handler ────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method === "GET") {
    return new Response("OK", { status: 200 });
  }

  try {
    const payload = await req.json();
    const incoming = parseWapiPayload(payload);

    if (incoming.length === 0) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const msg of incoming) {
      const phone = msg.from;
      console.log(`WhatsApp von ${phone}: ${msg.body || msg.caption || `[${msg.type}]`}`);

      const emp = await findEmployeeByPhone(phone);

      if (!emp || !emp.user_id) {
        console.log(`Unbekannte Nummer ${phone}`);
        continue;
      }

      if (!emp.whatsapp_aktiv) {
        await sendWhatsApp(
          phone,
          `Hallo ${emp.vorname}! Dein WhatsApp-Zugang wurde noch nicht vom Admin freigeschaltet. Bitte wende dich an deinen Vorgesetzten.`
        );
        continue;
      }

      const name = `${emp.vorname} ${emp.nachname}`.trim();
      const userId = emp.user_id;

      // ── Build user message ──
      let userMessage = "";
      let cachedImageBuffer: ArrayBuffer | null = null;

      if (msg.audioUrl) {
        // Voice message → transcribe with Whisper
        try {
          const transcription = await transcribeAudio(msg.audioUrl);
          userMessage = `[Sprachnachricht] ${transcription}`;
        } catch (e: any) {
          console.error("Transcription failed:", e);
          await sendWhatsApp(phone,
            "Entschuldigung, ich konnte deine Sprachnachricht leider nicht verstehen. Kannst du es nochmal als Text schreiben? 🙏"
          );
          continue;
        }
      } else if (msg.type === "image" || msg.mediaUrl) {
        userMessage = msg.caption
          ? `[Foto gesendet] ${msg.caption}`
          : "[Foto gesendet ohne Beschreibung]";

        // Download image IMMEDIATELY (WAPI URLs expire quickly)
        if (msg.mediaUrl) {
          try {
            console.log("Pre-downloading image...");
            cachedImageBuffer = await downloadMedia(msg.mediaUrl);
            console.log(`Image cached: ${cachedImageBuffer.byteLength} bytes`);
          } catch (e: any) {
            console.error("Image pre-download failed:", e);
            await sendWhatsApp(phone,
              "Entschuldigung, ich konnte das Bild leider nicht empfangen. Kannst du es nochmal schicken? 📸"
            );
            continue;
          }
        }
      } else {
        userMessage = msg.body || "";
      }

      if (!userMessage.trim()) continue;

      await saveMsg(phone, "incoming", userMessage, emp.id, userId);

      const [ctxData, history] = await Promise.all([
        gatherContext(userId),
        loadHistory(phone, 12),
      ]);

      const systemPrompt = buildSystemPrompt(
        name, ctxData.context, ctxData.todayHours, ctxData.remainingHours, ctxData.dailyTarget
      );

      // Pass cached image buffer reference instead of URL
      const mediaRef = cachedImageBuffer ? `__cached__` : undefined;

      const reply = await askGPT(
        systemPrompt, history, userMessage, userId, name, mediaRef, cachedImageBuffer
      );

      await saveMsg(phone, "outgoing", reply, emp.id, userId);
      await sendWhatsApp(phone, reply);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
