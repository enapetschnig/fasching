-- Update handle_new_user function to also make office@elektro-brodnig.at an administrator
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role app_role;
BEGIN
  -- Diese E-Mails werden immer Administrator
  IF NEW.email = 'napetschnig.chris@gmail.com' THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- ALLE Nutzer sind sofort aktiv (is_active = true)
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    true
  );
  
  RETURN NEW;
END;
$function$;