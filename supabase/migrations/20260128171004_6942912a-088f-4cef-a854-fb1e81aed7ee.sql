-- Test-User entfernt (existiert nicht auf neuem Projekt)

-- Funktion für automatische Profil-Erstellung bei erstem Login
CREATE OR REPLACE FUNCTION public.ensure_user_profile()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  user_email text;
  user_meta jsonb;
  assigned_role app_role;
BEGIN
  -- Get current user from auth context
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Check if profile already exists
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = current_user_id) THEN
    RETURN json_build_object('success', true, 'action', 'existing');
  END IF;
  
  -- Get user metadata from auth.users
  SELECT email, raw_user_meta_data 
  INTO user_email, user_meta
  FROM auth.users 
  WHERE id = current_user_id;
  
  -- Determine role based on email
  IF user_email IN ('napetschnig.chris@gmail.com') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  -- Create profile
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    current_user_id,
    COALESCE(user_meta->>'vorname', ''),
    COALESCE(user_meta->>'nachname', ''),
    true
  );
  
  -- Create role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN json_build_object(
    'success', true, 
    'action', 'created',
    'role', assigned_role
  );
END;
$$;