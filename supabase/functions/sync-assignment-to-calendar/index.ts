import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const CALENDAR_ID = "d072ed86f2ea170721f8fd46100ac8326a2a17c328a767b83591a2f16a5456aa@group.calendar.google.com";

// ─── Google Auth (JWT → Access Token) ────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const keyJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not configured");

  let creds;
  try {
    creds = JSON.parse(keyJson);
  } catch {
    creds = JSON.parse(keyJson.replace(/\\n/g, "\n").replace(/\\"/g, '"'));
  }

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${enc(header)}.${enc(payload)}`;

  const keyData = creds.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsignedToken)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${unsignedToken}.${sigB64}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

// ─── Google Calendar CRUD ────────────────────────────────

async function createOrUpdateEvent(
  accessToken: string,
  assignment: any,
  projectName: string,
  workerName: string,
  existingEventId?: string
): Promise<string> {
  const startDateTime = `${assignment.datum}T${assignment.start_time || "07:00"}:00`;
  const endDateTime = `${assignment.datum}T${assignment.end_time || "16:00"}:00`;

  const event = {
    summary: `${workerName} → ${projectName}`,
    description: assignment.notizen || "",
    start: { dateTime: startDateTime, timeZone: "Europe/Vienna" },
    end: { dateTime: endDateTime, timeZone: "Europe/Vienna" },
    transparency: "opaque",
  };

  const url = existingEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${existingEventId}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;

  const res = await fetch(url, {
    method: existingEventId ? "PUT" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Google Calendar error:", data);
    throw new Error(`Calendar API error: ${data.error?.message || res.status}`);
  }

  return data.id;
}

async function deleteEvent(accessToken: string, eventId: string) {
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${eventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
}

// ─── Main handler ────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, assignment_id } = await req.json();

    if (!action) {
      return new Response(JSON.stringify({ error: "action required (sync/delete)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getGoogleAccessToken();

    if (action === "delete" && assignment_id) {
      // Find the google_event_id stored on the assignment
      const { data: assignment } = await supabase
        .from("worker_assignments")
        .select("google_event_id")
        .eq("id", assignment_id)
        .maybeSingle();

      if (assignment?.google_event_id) {
        try {
          await deleteEvent(accessToken, assignment.google_event_id);
        } catch (e) {
          console.error("Delete event failed (may already be gone):", e);
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sync" && assignment_id) {
      // Fetch full assignment with project and profile
      const { data: assignment } = await supabase
        .from("worker_assignments")
        .select("*, projects(name)")
        .eq("id", assignment_id)
        .maybeSingle();

      if (!assignment) {
        return new Response(JSON.stringify({ error: "Assignment not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get worker name
      const { data: profile } = await supabase
        .from("profiles")
        .select("vorname, nachname")
        .eq("id", assignment.user_id)
        .maybeSingle();

      const workerName = profile ? `${profile.vorname} ${profile.nachname}` : "Mitarbeiter";
      const projectName = (assignment as any).projects?.name || "Projekt";

      const googleEventId = await createOrUpdateEvent(
        accessToken,
        assignment,
        projectName,
        workerName,
        assignment.google_event_id || undefined
      );

      // Store the Google Event ID on the assignment
      await supabase
        .from("worker_assignments")
        .update({ google_event_id: googleEventId })
        .eq("id", assignment.id);

      return new Response(JSON.stringify({ ok: true, google_event_id: googleEventId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bulk sync: sync ALL assignments for a date range
    if (action === "sync_all") {
      const { start_date, end_date } = await req.json().catch(() => ({}));
      const from = start_date || new Date().toISOString().split("T")[0];
      const to = end_date || from;

      const { data: allAssignments } = await supabase
        .from("worker_assignments")
        .select("*, projects(name)")
        .gte("datum", from)
        .lte("datum", to);

      if (!allAssignments?.length) {
        return new Response(JSON.stringify({ ok: true, synced: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get all profiles
      const userIds = [...new Set(allAssignments.map((a: any) => a.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", userIds);

      const profileMap: Record<string, string> = {};
      (profiles || []).forEach((p: any) => {
        profileMap[p.id] = `${p.vorname} ${p.nachname}`;
      });

      let synced = 0;
      for (const a of allAssignments) {
        try {
          const gid = await createOrUpdateEvent(
            accessToken,
            a,
            (a as any).projects?.name || "Projekt",
            profileMap[a.user_id] || "Mitarbeiter",
            a.google_event_id || undefined
          );

          await supabase
            .from("worker_assignments")
            .update({ google_event_id: gid })
            .eq("id", a.id);

          synced++;
        } catch (e) {
          console.error(`Sync failed for ${a.id}:`, e);
        }
      }

      return new Response(JSON.stringify({ ok: true, synced }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
