const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ParsedResult {
  beschreibung: string;
  materials: Array<{ material: string; menge: string }>;
  kundeName?: string;
  kundeAdresse?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, context } = await req.json();

    if (!transcript || typeof transcript !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Kein Transkript erhalten" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "OpenAI API Key nicht konfiguriert" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const contextKind = context === "material" ? "material" : "arbeiten";

    const arbeitenPrompt = `Du bist ein Assistent für FASCHING Gebäudetechnik (Heizung, Kälte, Lüftung, Sanitär, Service).
Du erhältst eine Sprachaufnahme eines Technikers. Schreibe daraus einen sauberen, kundentauglichen Arbeitsbericht
der durchgeführten Arbeiten.

Stil:
- Sachlich und professionell – so, wie er auf einem Arbeitsbericht an den Kunden steht.
- Vollständige deutsche Sätze im Präteritum oder Perfekt (z.B. "Heizkörper wurden montiert" / "Die Dichtheitsprüfung wurde durchgeführt").
- Keine Ich-Form, keine Füllwörter ("also", "dann halt", "hab", "so"), keine Umgangssprache.
- Tippfehler, Spracherkennungsfehler und Groß-/Kleinschreibung still korrigieren.
  Fachbegriffe korrekt schreiben (z.B. "Fußbodenheizung", "Heizkörper", "Sanitär").
- Logisch gliedern: mehrere Tätigkeiten durch Zeilenumbrüche oder Aufzählungspunkte trennen,
  wenn die Reihenfolge/Struktur das erleichtert.
- Nichts hinzuerfinden und nichts weglassen, was fachlich relevant ist.

Beispiel-Input: "also hab heute fünf heizkörper montiert und dann noch die fusbohdenheizung im erdgeschoss angeschlossen und am schluss ne dichtheitsprüfung gemacht"
Beispiel-Output:
Fünf Heizkörper wurden montiert. Anschließend erfolgte der Anschluss der Fußbodenheizung im Erdgeschoss. Abschließend wurde eine Dichtheitsprüfung durchgeführt.

Antworte NUR mit dem fertigen Arbeitsbericht-Text, kein JSON, kein Markdown, kein Drumherum.`;

    const materialPrompt = `Du bist ein Assistent für FASCHING Gebäudetechnik. Der Techniker diktiert eine Liste
von verwendetem Material mit Mengen.

Format:
- Jedes Material auf EIGENER Zeile
- Struktur: "<Menge> <Einheit> <Materialname>" (z.B. "5 Stk Heizkörper", "3 m Kupferrohr 15 mm", "1 Rolle Isolierung")
- Mengen und Einheiten nicht weglassen, wenn erwähnt. Wenn keine Menge genannt wurde, nur den Materialnamen.
- Fachbegriffe und Dimensionen sauber schreiben (z.B. "Kupferrohr 15 mm", "Heizkörperventil 1/2 Zoll").
- KEINE Überschrift, KEINE Erklärsätze, KEINE Aufzählungszeichen wie "-" oder "*". Nur die reine Liste.
- Tippfehler / Spracherkennungsfehler still korrigieren.

Beispiel-Input: "drei kupferrohre fünfzehn millimeter, fünf heizkörperventile zwei und nochmal isolierung"
Beispiel-Output:
3 Stk Kupferrohr 15 mm
5 Stk Heizkörperventile
1 Rolle Isolierung

Antworte NUR mit der Material-Liste, kein JSON, kein Markdown, kein Drumherum.`;

    const systemPrompt = contextKind === "material" ? materialPrompt : arbeitenPrompt;
    const userContent = transcript;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText);
      const errorMsg = response.status === 429
        ? "KI-Dienst vorübergehend überlastet. Bitte in 30 Sekunden erneut versuchen."
        : response.status === 401
        ? "OpenAI API-Key ungültig. Bitte im Supabase Dashboard prüfen."
        : `OpenAI API Fehler: ${response.status}`;
      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || "").trim();

    // Fallback: Rohtranskript, falls KI leer geantwortet hat
    const beschreibung = content || transcript;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          beschreibung,
          materials: [],
          kundeName: null,
          kundeAdresse: null,
        },
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    console.error("parse-voice-input error:", err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error)?.message || "Unbekannter Fehler" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
