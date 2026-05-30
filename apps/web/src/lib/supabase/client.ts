'use client';

import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | undefined;

/**
 * Browser Supabase client (singleton). Sessions are stored in cookies via
 * @supabase/ssr so middleware and the server can read them too — no localStorage.
 * Created lazily so importing this module never runs during build/prerender.
 */
export function getSupabaseBrowser() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
