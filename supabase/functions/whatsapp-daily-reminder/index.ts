import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN")!;
const WAPI_BASE = "https://gate.whapi.cloud";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
  return res.json();
}

function formatPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  if (cleaned.startsWith("0")) cleaned = `43${cleaned.slice(1)}`;
  return cleaned;
}

async function getSetting(key: string, fallback: string): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value || fallback;
}

// Working hours per day (same as webhook)
function getDailyTarget(): number {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return 0;
  if (day >= 1 && day <= 4) return 8.5;
  if (day === 5) return 5.0;
  return 0;
}

async function getProjectList(): Promise<string> {
  const { data: projects } = await supabase
    .from("projects")
    .select("name")
    .eq("status", "aktiv")
    .order("name");

  if (!projects?.length) return "";
  return projects.map((p: any, i: number) => `${i + 1}. ${p.name}`).join("\n");
}

async function generateReminderMessage(
  name: string,
  scheduleInfo: string,
  todayHours: number,
  isEvening: boolean,
  projectList: string
): Promise<string> {
  const dailyTarget = getDailyTarget();
  const remaining = Math.max(0, dailyTarget - todayHours);

  const dayNames = [
    "Sonntag", "Montag", "Dienstag", "Mittwoch",
    "Donnerstag", "Freitag", "Samstag",
  ];
  const dayName = dayNames[new Date().getDay()];

  if (isEvening && remaining > 0) {
    // Evening reminder: direct, with project list ready to go
    let msg = `Hey ${name}! 👋\n\n`;
    msg += `Du hast heute noch *${remaining}h* offen (${todayHours > 0 ? `${todayHours}/${dailyTarget}h gebucht` : `${dailyTarget}h Tagessoll`}).\n\n`;
    msg += `*Auf welches Projekt?*\n${projectList}\n\n`;
    msg += `Antwort z.B.: _"1 ${remaining}h Kabel verlegt"_`;
    return msg;
  }

  if (isEvening && remaining <= 0) {
    // Already done for the day
    return `Hey ${name}! Deine Stunden für heute sind komplett (${todayHours}h) ✓ Schönen Feierabend! 🍺`;
  }

  // Morning message
  let msg = `Guten Morgen ${name}! ☀️\n\n`;
  if (scheduleInfo) {
    msg += `📋 *Deine Einteilung heute:* ${scheduleInfo}\n\n`;
  }
  msg += `Tagessoll: *${dailyTarget}h* (${dayName})\n\n`;
  msg += `*Projekte:*\n${projectList}\n\n`;
  msg += `Stunden schreiben = Nummer + Stunden, z.B. _"1 8h Montage"_`;
  return msg;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let reminderType = "auto";
    try {
      const body = await req.json();
      reminderType = body?.type || "auto";
    } catch { /* no body */ }

    const hour = new Date().getHours();
    const isEvening =
      reminderType === "evening" ||
      (reminderType === "auto" && hour >= 14);

    const enabled = isEvening
      ? await getSetting("whatsapp_reminder_enabled", "true")
      : await getSetting("whatsapp_morning_enabled", "true");

    if (enabled !== "true") {
      return new Response(
        JSON.stringify({ message: "Reminders disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const allowedDays = await getSetting("whatsapp_reminder_days", "mo,di,mi,do,fr");
    const dayMap: Record<number, string> = {
      0: "so", 1: "mo", 2: "di", 3: "mi", 4: "do", 5: "fr", 6: "sa",
    };
    const todayDay = dayMap[new Date().getDay()];
    if (!allowedDays.includes(todayDay)) {
      return new Response(
        JSON.stringify({ message: `${todayDay} not in allowed days` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const today = new Date().toISOString().split("T")[0];

    // Only send to admin-verified WhatsApp numbers
    const { data: employees } = await supabase
      .from("employees")
      .select("id, vorname, nachname, telefon, user_id")
      .eq("whatsapp_aktiv", true)
      .not("telefon", "is", null)
      .not("user_id", "is", null);

    if (!employees?.length) {
      return new Response(
        JSON.stringify({ message: "No employees" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For evening: skip employees who already reached their daily target
    const dailyTarget = getDailyTarget();
    let usersWithEnoughHours = new Set<string>();
    if (isEvening) {
      const { data: entries } = await supabase
        .from("time_entries")
        .select("user_id, stunden")
        .eq("datum", today);

      const hoursByUser: Record<string, number> = {};
      (entries || []).forEach((e: any) => {
        hoursByUser[e.user_id] = (hoursByUser[e.user_id] || 0) + e.stunden;
      });
      Object.entries(hoursByUser).forEach(([uid, h]) => {
        if (h >= dailyTarget - 0.5) usersWithEnoughHours.add(uid);
      });
    }

    // Load project list once for all employees
    const projectList = await getProjectList();

    let sentCount = 0;
    const results: any[] = [];

    for (const emp of employees) {
      if (!emp.telefon || !emp.user_id) continue;
      if (isEvening && usersWithEnoughHours.has(emp.user_id)) {
        results.push({ name: `${emp.vorname} ${emp.nachname}`, sent: false, reason: "hours_ok" });
        continue;
      }

      try {
        const { data: todayEntries } = await supabase
          .from("time_entries")
          .select("stunden")
          .eq("user_id", emp.user_id)
          .eq("datum", today);

        const todayHours = (todayEntries || []).reduce(
          (sum: number, e: any) => sum + (e.stunden || 0), 0
        );

        let scheduleInfo = "";
        const { data: assignments } = await supabase
          .from("worker_assignments")
          .select("project_id, projects(name)")
          .eq("worker_id", emp.user_id)
          .eq("date", today);

        if (assignments?.length) {
          scheduleInfo = assignments
            .map((a: any) => a.projects?.name || "?")
            .join(", ");
        }

        const message = await generateReminderMessage(
          emp.vorname,
          scheduleInfo,
          todayHours,
          isEvening,
          projectList
        );

        const waPhone = formatPhone(emp.telefon);
        await sendWhatsApp(waPhone, message);

        await supabase.from("whatsapp_messages").insert({
          phone: waPhone,
          direction: "outgoing",
          message_body: message,
          employee_id: emp.id,
          user_id: emp.user_id,
          processed: true,
        });

        sentCount++;
        results.push({ name: `${emp.vorname} ${emp.nachname}`, sent: true });
      } catch (err: any) {
        console.error(`Failed for ${emp.vorname}:`, err);
        results.push({ name: `${emp.vorname} ${emp.nachname}`, sent: false, reason: err.message });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, type: isEvening ? "evening" : "morning", sentCount, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Reminder error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
