import type { Metadata } from 'next';
import Link from 'next/link';
import { InvoiceForm } from './InvoiceForm';

export const metadata: Metadata = {
  title: 'New Invoice | Invoice Platform',
};

export default function NewInvoicePage() {
  return (
    <div data-theme="dark" className="min-h-screen bg-background text-foreground">

      {/* ── Top navigation ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Invoices
            </Link>
            <span className="text-border">/</span>
            <span className="font-medium">New Invoice</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-amber-400 font-medium tracking-wide">
              DRAFT
            </span>
            <span className="text-muted-foreground hidden sm:inline">
              EN&nbsp;16931&nbsp;·&nbsp;Peppol&nbsp;BIS&nbsp;3.0
            </span>
          </div>
        </div>
      </header>

      {/* ── Page body ──────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold tracking-tight">Create Invoice</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Peppol BIS Billing 3.0 · EN 16931 · UBL 2.1
          </p>
        </div>

        <InvoiceForm />
      </main>
    </div>
  );
}
