// =====================================================================
//  CONFIG — the only file you need to edit after setting up Supabase.
//
//  Follow SETUP.md, then paste your two values below. Both of these are
//  safe to publish: the anon key only ever grants what your Row Level
//  Security policies allow (public read of published parts).
//
//  NEVER paste the service_role key here. It bypasses every policy.
//
//  Leave them blank and the app simply uses its built-in parts, with no
//  network calls at all.
// =====================================================================

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// Names created by the SQL in SETUP.md. Change only if you renamed them.
export const PARTS_TABLE = 'mascot_parts';
export const VERSIONS_TABLE = 'mascot_part_versions';
export const ASSET_BUCKET = 'mascot-assets';

// How long the app waits for Supabase before falling back to its cache.
export const FETCH_TIMEOUT_MS = 4000;

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
