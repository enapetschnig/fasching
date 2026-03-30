-- Neuen Storage Bucket für Chef-Dateien erstellen (nur für Admins)
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-chef', 'project-chef', false) ON CONFLICT (id) DO NOTHING;

-- SELECT: Nur Admins können Chef-Dateien sehen
CREATE POLICY "Admins can view chef files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'project-chef' 
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);

-- INSERT: Nur Admins können Chef-Dateien hochladen
CREATE POLICY "Admins can upload chef files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'project-chef' 
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);

-- DELETE: Nur Admins können Chef-Dateien löschen
CREATE POLICY "Admins can delete chef files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'project-chef' 
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);