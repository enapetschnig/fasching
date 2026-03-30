-- Create disturbance_photos table
CREATE TABLE public.disturbance_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disturbance_id uuid NOT NULL REFERENCES public.disturbances(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.disturbance_photos ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view disturbance photos"
ON public.disturbance_photos FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own disturbance photos"
ON public.disturbance_photos FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own disturbance photos"
ON public.disturbance_photos FOR DELETE
USING (auth.uid() = user_id OR has_role(auth.uid(), 'administrator'));

-- Create storage bucket for disturbance photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('disturbance-photos', 'disturbance-photos', true) ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload disturbance photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'disturbance-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view disturbance photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'disturbance-photos');

CREATE POLICY "Users can delete own disturbance photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'disturbance-photos' AND auth.uid() IS NOT NULL);