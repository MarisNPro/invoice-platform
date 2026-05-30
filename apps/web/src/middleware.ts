import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

/**
 * Global middleware: refreshes the Supabase session and enforces auth routing
 * (see updateSession). Public: /login, /signup, /auth/callback, /legal/*, and
 * `/` (landing). Everything else requires a session.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
