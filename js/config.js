/* =========================================================
   Tint Master Inc — connection settings
   Fill these in from Supabase: Project Settings → API (or "API Keys").

   • SUPABASE_URL:      the "Project URL", e.g. https://abcdxyz.supabase.co
   • SUPABASE_ANON_KEY: the "anon public" key (or the newer "publishable" key)

   These two values are SAFE to put in a public website/GitHub repo.
   The database security rules (supabase/schema.sql) are what keep
   appointments private. NEVER put the "service_role" / "secret" key here.
   ========================================================= */
window.TINT_CONFIG = {
  SUPABASE_URL: "https://wykjllhtfqaavjnajlab.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_ZugyRR6nyL2PEZKjxcSboA_R18_GRK5",

  // Used only if Supabase isn't set up yet: the booking form falls back to
  // opening the customer's email app addressed here.
  // TODO: change to the real shop email before launch.
  BOOKING_EMAIL: "tintmasterpro@gmail.com",
};
