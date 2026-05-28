import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { ImportListItem } from '@/lib/api';
import { ImportsTable } from './ImportsTable';

export const metadata: Metadata = {
  title: 'Imports | Invoice Platform',
};

export default async function ImportsPage() {
  const rows = await apiGet<ImportListItem[]>('/imports');

  return (
    <div data-theme="dark" className="min-h-screen bg-background text-foreground">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Dashboard
            </Link>
            <span className="text-border">/</span>
            <span className="font-medium">Imports</span>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'import' : 'imports'}
          </span>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Import History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF invoices uploaded for AI extraction. Click a row to open the review form.
          </p>
        </div>

        <ImportsTable rows={rows} />
      </main>
    </div>
  );
}
