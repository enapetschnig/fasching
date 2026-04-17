import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.79.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error('Unauthorized');

    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData || roleData.role !== 'administrator') {
      throw new Error('Forbidden: Admin access required');
    }

    const { email, appUrl: appUrlFromRequest } = await req.json();
    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      throw new Error('Ungültige E-Mail-Adresse');
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) throw new Error('RESEND_API_KEY not configured');

    const appUrl = appUrlFromRequest || Deno.env.get('APP_URL') || 'https://fasching-gebaeudetechnik.app';
    const registrationLink = `${appUrl.replace(/\/$/, '')}/auth`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FASCHING Gebäudetechnik <noreply@chrisnapetschnig.at>',
        to: [email],
        subject: 'Einladung zur FASCHING Gebäudetechnik Mitarbeiter-App',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Willkommen bei FASCHING Gebäudetechnik!</h2>
            <p style="color: #555; font-size: 16px;">
              Du wurdest eingeladen, dich in unserer Mitarbeiter-App zu registrieren.
            </p>
            <p style="color: #555; font-size: 16px;">
              Klicke auf den folgenden Link, um dich zu registrieren:
            </p>
            <a href="${registrationLink}" 
               style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 6px; font-size: 16px; margin: 16px 0;">
              Jetzt registrieren
            </a>
            <p style="color: #888; font-size: 14px; margin-top: 24px;">
              Oder kopiere diesen Link: ${registrationLink}
            </p>
          </div>
        `,
      }),
    });

    const resendData = await resendResponse.json();
    if (!resendResponse.ok) {
      throw new Error(`E-Mail-Versand fehlgeschlagen: ${JSON.stringify(resendData)}`);
    }

    await supabase.from('invitation_logs').insert({
      telefonnummer: '-',
      email: email,
      gesendet_von: user.id,
      status: 'gesendet',
    });

    return new Response(
      JSON.stringify({ success: true, message: 'E-Mail erfolgreich gesendet' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
