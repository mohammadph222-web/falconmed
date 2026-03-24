import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const envDebug = {
  url: supabaseUrl,
  hasKey: !!supabaseAnonKey,
};

let supabase = null;
let supabaseError = "";

try {
  if (!supabaseUrl) {
    throw new Error("Missing VITE_SUPABASE_URL");
  }
  if (!supabaseAnonKey) {
    throw new Error("Missing VITE_SUPABASE_ANON_KEY");
  }

  supabase = createClient(supabaseUrl, supabaseAnonKey);
} catch (err) {
  supabaseError = err?.message || "Unknown Supabase init error";
}

export { supabase, supabaseError };