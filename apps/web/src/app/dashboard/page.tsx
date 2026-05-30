'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, type InvoiceListResponse } from '@/lib/api';
import { getSupabaseBrowser } from '@/lib/supabase/client';

const NAV = [
  { href: '/invoices', label: 'Invoices', desc: 'Create, send, track' },
  { href: '/customers', label: 'Customers', desc: 'Manage clients' },
  { href: '/imports', label: 'Imports', desc: 'OCR supplier invoices' },
  { href: '/settings/archive', label: 'Cloud archive', desc: 'Auto-save PDFs + XML' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [invoiceTotal, setInvoiceTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await getSupabaseBrowser().auth.getUser();
      if (active) setEmail(data.user?.email ?? '');
    })();

    // Tenant-scoped read — proves the Bearer token + tenant isolation end-to-end.
    apiGet<InvoiceListResponse>('/invoices?limit=1')
      .then((r) => setInvoiceTotal(r.meta.total))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div data-theme="dark" className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <span className="font-medium">Dashboard</span>
          <div className="flex items-center gap-3 text-sm">
            {email && <span className="text-muted-foreground">{email}</span>}
            <button
              type="button"
              onClick={signOut}
              className="h-8 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <section className="rounded-xl border border-border bg-card p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Total invoices
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {error ? '—' : invoiceTotal ?? '…'}
          </p>
          {error && (
            <p className="mt-2 text-xs text-destructive">
              Could not load tenant data: {error}
            </p>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
            >
              <p className="font-medium">{n.label}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{n.desc}</p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
