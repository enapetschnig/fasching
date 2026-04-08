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
    const { transcript } = await req.json();

    if (!transcript || typeof transcript !== "string") {
      return new Response(
        JSON.stringify({ error: "Kein Transkript erhalten" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API Key nicht konfiguriert" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const systemPrompt = `Du bist ein Assistent für FASCHING Gebäudetechnik (Heizung, Kälte, Lüftung, Sanitär, Service).
Du erhältst eine Sprachaufnahme eines Technikers, der einen Arbeitsbericht diktiert.

Extrahiere daraus folgende Informationen und gib NUR valides JSON zurück:

{
  "beschreibung": "Zusammenfassung der durchgeführten Tätigkeiten als Fließtext",
  "materials": [
    { "material": "Materialname", "menge": "Menge mit Einheit" }
  ],
  "kundeName": "Name des Kunden (falls erwähnt, sonst null)",
  "kundeAdresse": "Adresse des Kunden (falls erwähnt, sonst null)"
}

Regeln:
- Beschreibung: Fachlich korrekt formulieren, kurz und prägnant. Aus der Ich-Perspektive in die dritte Person umwandeln.
- Material: Jedes erwähnte Material mit Menge als eigenen Eintrag. Typische Materialien: Rohre, Fittings, Ventile, Thermostate, Pumpen, Dichtungen, Isolierung, etc.
- Wenn keine Materialien erwähnt werden: leeres Array []
- Wenn kein Kundenname erwähnt: null
- Antworte NUR mit dem JSON-Objekt, kein Markdown, kein Text drumherum.`;

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
          { role: "user", content: transcript },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `OpenAI API Fehler: ${response.status}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ error: "Keine Antwort von OpenAI erhalten" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Parse the JSON response from OpenAI
    let parsed: ParsedResult;
    try {
      // Remove potential markdown code fences
      const cleanJson = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error("Failed to parse OpenAI response:", content);
      return new Response(
        JSON.stringify({ error: "KI-Antwort konnte nicht verarbeitet werden", raw: content }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          beschreibung: parsed.beschreibung || "",
          materials: Array.isArray(parsed.materials) ? parsed.materials : [],
          kundeName: parsed.kundeName || null,
          kundeAdresse: parsed.kundeAdresse || null,
        },
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    console.error("parse-voice-input error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unbekannter Fehler" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
