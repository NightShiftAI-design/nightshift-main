import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const supabase = createClient(
  "https://sbzdnzouoyxmawuhdvdi.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiemRuem91b3l4bWF3dWhkdmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMDY3ODgsImV4cCI6MjA4MDc4Mjc4OH0.SV4XppZoez27_g69NsjZNeJ989bhrEAAvR_XoD5w2Ho"
);
