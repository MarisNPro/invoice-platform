import type { Metadata } from 'next';
import Link from 'next/link';
import { InvoiceForm } from './InvoiceForm';

export const metadata: Metadata = {
  title: 'New Invoice | Invoice Platform',
};

export default function NewInvoicePage() {
  return (
    <div className="min-h-screen bg-muted/20">
      {/* Top nav bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              ← Invoices
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium">New Invoice</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 font-medium">DRAFT</span>
            <span>EN 16931 compliant</span>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
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
