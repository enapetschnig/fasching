-- Enable realtime for projects and time_entries
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;

-- Create storage buckets for project documents
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('project-plans', 'project-plans', false),
  ('project-reports', 'project-reports', false),
  ('project-photos', 'project-photos', true),
  ('project-materials', 'project-materials', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for project-plans
CREATE POLICY "Authenticated users can view project plans"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-plans' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload project plans"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-plans' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update project plans"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-plans' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete project plans"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-plans' AND has_role(auth.uid(), 'administrator'::app_role));

-- Storage policies for project-reports
CREATE POLICY "Authenticated users can view project reports"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-reports' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload project reports"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-reports' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update project reports"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-reports' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete project reports"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-reports' AND has_role(auth.uid(), 'administrator'::app_role));

-- Storage policies for project-photos (public bucket)
CREATE POLICY "Anyone can view project photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-photos');

CREATE POLICY "Authenticated users can upload project photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update project photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete project photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-photos' AND has_role(auth.uid(), 'administrator'::app_role));

-- Storage policies for project-materials
CREATE POLICY "Authenticated users can view project materials"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-materials' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload project materials"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-materials' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update project materials"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-materials' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete project materials"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-materials' AND has_role(auth.uid(), 'administrator'::app_role));