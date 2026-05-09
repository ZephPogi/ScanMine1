import { createClient } from '@supabase/supabase-js';

// These are the PUBLIC / anon credentials — safe to expose in the frontend bundle.
// The anon key is restricted by Supabase Row Level Security (RLS) policies.
// To find your anon key: Supabase Dashboard → Settings → API → "anon / public" key
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://zkjovjselmjaxxqaosia.supabase.co';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

if (!SUPABASE_ANON_KEY) {
  console.warn(
    '[ScanMine] REACT_APP_SUPABASE_ANON_KEY is not set. ' +
    'Add it to your .env file (root of the project) or Vercel environment variables. ' +
    'Find it at: Supabase Dashboard → Settings → API → anon/public key.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
