import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});

// Session-Expiry: Automatisch ausloggen wenn Token abläuft
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    // Nur redirecten wenn nicht bereits auf /auth
    if (!window.location.pathname.startsWith('/auth')) {
      window.location.href = '/auth';
    }
  }
});
