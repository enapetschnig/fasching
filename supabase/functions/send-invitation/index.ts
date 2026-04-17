import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.79.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvitationRequest {
  telefonnummer: string;
  appUrl?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Send invitation function called');

    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the authenticated user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      console.error('Authentication error:', userError);
      throw new Error('Unauthorized');
    }

    // Check if user is admin
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData || roleData.role !== 'administrator') {
      console.error('User is not an administrator');
      throw new Error('Forbidden: Admin access required');
    }

    // Parse request body
    const { telefonnummer, appUrl: appUrlFromRequest }: InvitationRequest = await req.json();
    console.log('Processing invitation for:', telefonnummer);

    // Validate phone number (E.164 format: +43...)
    if (!telefonnummer || !telefonnummer.match(/^\+43\d{9,13}$/)) {
      throw new Error('Ungültige Telefonnummer. Bitte Format +43... verwenden');
    }

    // Get Twilio credentials
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      throw new Error('Twilio credentials not configured');
    }

    // Generate registration link (from request origin, fallback to env, fallback to default)
    const appUrl = appUrlFromRequest || Deno.env.get('APP_URL') || 'https://fasching-gebaeudetechnik.app';
    const registrationLink = `${appUrl.replace(/\/$/, '')}/auth`;

    // Compose SMS message
    const smsText = `Willkommen bei FASCHING Gebäudetechnik! Bitte registriere dich in unserer Mitarbeiter-App:\n${registrationLink}`;

    console.log('Sending SMS via Twilio...');

    // Send SMS via Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: telefonnummer,
        From: twilioPhoneNumber,
        Body: smsText,
      }),
    });

    const twilioData = await twilioResponse.json();
    
    if (!twilioResponse.ok) {
      console.error('Twilio error response:', twilioData);
      throw new Error(`SMS-Versand fehlgeschlagen: ${JSON.stringify(twilioData)}`);
    }

    console.log('SMS sent successfully:', twilioData.sid);
    console.log('Full Twilio response:', twilioData);

    // Log the invitation
    const { error: logError } = await supabase
      .from('invitation_logs')
      .insert({
        telefonnummer,
        gesendet_von: user.id,
        status: 'gesendet',
      });

    if (logError) {
      console.error('Error logging invitation:', logError);
      // Don't fail the request if logging fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'SMS erfolgreich gesendet',
        messageSid: twilioData.sid,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in send-invitation function:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten';
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  }
});