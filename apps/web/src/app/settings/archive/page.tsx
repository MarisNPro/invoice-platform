import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ArchiveCards } from './ArchiveCards';

export const metadata: Metadata = {
  title: 'Cloud Archive | Invoice Platform',
};

interface ArchiveStatus {
  provider:    string;
  label:       string;
  isConnected: boolean;
  folderPath:  string;
  lastSyncAt:  string | null;
  lastError:   string | null;
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; provider?: string; error?: string }>;
}) {
  const params  = await searchParams;
  const statuses = await apiGet<ArchiveStatus[]>('/archive/status');

  return (
    <div data-theme="dark" className="min-h-screen bg-background text-foreground">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">
              ← Dashboard
            </Link>
            <span className="text-border">/</span>
            <span className="text-muted-foreground">Settings</span>
            <span className="text-border">/</span>
            <span className="font-medium">Cloud Archive</span>
          </div>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold tracking-tight">Cloud Archive</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            After an invoice is sent, the PDF and UBL XML are automatically saved to your
            connected cloud storage.
          </p>
        </div>

        <Suspense>
          <ArchiveCards
            statuses={statuses}
            connected={params.connected}
            connectedProvider={params.provider}
            error={params.error}
          />
        </Suspense>

        {/* How it works */}
        <div className="mt-8 rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">How it works</h2>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li><span className="mr-2 font-mono text-primary">1.</span>Click <strong className="text-foreground">Connect</strong> and authorise InvoicePlatform in the provider's consent screen.</li>
            <li><span className="mr-2 font-mono text-primary">2.</span>After an invoice is sent, the PDF + UBL XML are uploaded to <code className="rounded bg-muted px-1 py-0.5 text-xs">/InvoiceArchive/YYYY/MM/</code>.</li>
            <li><span className="mr-2 font-mono text-primary">3.</span>Files are named <code className="rounded bg-muted px-1 py-0.5 text-xs">INV-2026-00002.pdf</code> and <code className="rounded bg-muted px-1 py-0.5 text-xs">INV-2026-00002.xml</code>.</li>
            <li><span className="mr-2 font-mono text-primary">4.</span>You can connect multiple providers simultaneously — each receives a copy.</li>
          </ol>
        </div>
      </main>
    </div>
  );
}
