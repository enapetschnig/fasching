-- Create storage bucket for project notizen (notepad templates)
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-notizen', 'project-notizen', false) ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload notizen
CREATE POLICY "Authenticated users can upload notizen"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'project-notizen');

-- Allow authenticated users to view notizen
CREATE POLICY "Authenticated users can view notizen"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'project-notizen');

-- Only admins can delete notizen
CREATE POLICY "Only admins can delete notizen"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'project-notizen' 
  AND public.has_role(auth.uid(), 'administrator')
);