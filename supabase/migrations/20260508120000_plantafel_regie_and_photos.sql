-- Plantafel: Regie-Einteilungen + Fotos pro Zuweisung
-- Idempotent: kann mehrfach gefahren werden, wenn vorheriger Push abgebrochen ist.

-- 1) worker_assignments um "kind" erweitern und project_id nullable machen
ALTER TABLE public.worker_assignments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'projekt';

ALTER TABLE public.worker_assignments
  DROP CONSTRAINT IF EXISTS worker_assignments_kind_check;
ALTER TABLE public.worker_assignments
  ADD CONSTRAINT worker_assignments_kind_check CHECK (kind IN ('projekt', 'regie'));

ALTER TABLE public.worker_assignments
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.worker_assignments
  DROP CONSTRAINT IF EXISTS worker_assignments_kind_project_check;
ALTER TABLE public.worker_assignments
  ADD CONSTRAINT worker_assignments_kind_project_check CHECK (
    (kind = 'projekt' AND project_id IS NOT NULL) OR
    (kind = 'regie' AND project_id IS NULL)
  );

ALTER TABLE public.worker_assignments DROP CONSTRAINT IF EXISTS worker_assignments_unique;
CREATE UNIQUE INDEX IF NOT EXISTS worker_assignments_unique_idx
  ON public.worker_assignments (
    user_id,
    datum,
    kind,
    COALESCE(project_id::text, ''),
    COALESCE(start_time, '')
  );

-- 2) Foto-Tabelle pro Assignment
CREATE TABLE IF NOT EXISTS public.worker_assignment_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.worker_assignments(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_assignment_photos_assignment
  ON public.worker_assignment_photos(assignment_id);

ALTER TABLE public.worker_assignment_photos ENABLE ROW LEVEL SECURITY;

-- Admin: alles
DROP POLICY IF EXISTS admin_all_assignment_photos ON public.worker_assignment_photos;
CREATE POLICY "admin_all_assignment_photos" ON public.worker_assignment_photos
  FOR ALL USING (
    public.has_role(auth.uid(), 'administrator'::public.app_role)
  );

-- MA darf Fotos seiner eigenen Zuweisungen lesen
DROP POLICY IF EXISTS user_read_own_assignment_photos ON public.worker_assignment_photos;
CREATE POLICY "user_read_own_assignment_photos" ON public.worker_assignment_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.worker_assignments wa
      WHERE wa.id = worker_assignment_photos.assignment_id
        AND wa.user_id = auth.uid()
    )
  );

-- Realtime-Publication: nur hinzufügen, wenn noch nicht enthalten
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'worker_assignment_photos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_assignment_photos;
  END IF;
END $$;

-- 3) Storage-Bucket für Plantafel-Fotos
INSERT INTO storage.buckets (id, name, public)
VALUES ('assignment-photos', 'assignment-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can upload assignment photos" ON storage.objects;
CREATE POLICY "Authenticated can upload assignment photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'assignment-photos' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Anyone can view assignment photos" ON storage.objects;
CREATE POLICY "Anyone can view assignment photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'assignment-photos');

DROP POLICY IF EXISTS "Authenticated can delete assignment photos" ON storage.objects;
CREATE POLICY "Authenticated can delete assignment photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'assignment-photos' AND auth.uid() IS NOT NULL);
