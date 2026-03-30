-- WhatsApp message log for tracking incoming/outgoing messages
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_body TEXT,
  message_type TEXT DEFAULT 'text',
  employee_id UUID REFERENCES public.employees(id),
  user_id UUID REFERENCES auth.users(id),
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all whatsapp messages" ON public.whatsapp_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'administrator')
  );

CREATE POLICY "Service role full access whatsapp" ON public.whatsapp_messages
  FOR ALL USING (true) WITH CHECK (true);

-- Calendar events table for Google Calendar sync
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  google_event_id TEXT UNIQUE,
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  all_day BOOLEAN DEFAULT true,
  start_time TEXT,
  end_time TEXT,
  description TEXT,
  mitarbeiter TEXT[],
  calendar_type TEXT,
  project_type TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read calendar events" ON public.calendar_events
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage calendar events" ON public.calendar_events
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'administrator')
  );

-- app_settings table already exists from earlier migration, just ensure defaults

-- WhatsApp configuration defaults
INSERT INTO public.app_settings (key, value) VALUES
  ('whatsapp_enabled', 'true'),
  ('whatsapp_reminder_enabled', 'true'),
  ('whatsapp_reminder_time', '17:00'),
  ('whatsapp_reminder_days', 'mo,di,mi,do,fr'),
  ('whatsapp_morning_enabled', 'true'),
  ('whatsapp_morning_time', '07:00'),
  ('whatsapp_bot_name', 'eBauer Assistent')
ON CONFLICT (key) DO NOTHING;
