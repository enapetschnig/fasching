-- Plantafel: Regie/Projekt bekommen optionalen Titel (z.B. "Wartung Müller")
-- Bei Regie wird der Titel als Hauptlabel statt "Regie" angezeigt.
ALTER TABLE public.worker_assignments
  ADD COLUMN IF NOT EXISTS title TEXT;
