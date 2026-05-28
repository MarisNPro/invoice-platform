import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Invoice | Invoice Platform',
};

interface Props {
  params: { id: string };
}

export default function InvoicePage({ params }: Props) {
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-40 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Invoices</Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Invoice</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Invoice saved</h1>
            <p className="mt-1 text-sm text-muted-foreground font-mono">{params.id}</p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-700 font-medium">DRAFT</span>
        </div>

        {/* Download actions */}
        <div className="flex gap-3 flex-wrap">
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/invoices/${params.id}/pdf`}
            download
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            ⬇ Download PDF
          </a>
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/invoices/${params.id}/ubl`}
            download
            className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
          >
            ⬇ Download UBL XML
          </a>
          <Link
            href="/invoices/new"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
          >
            + New Invoice
          </Link>
        </div>

        <p className="text-sm text-muted-foreground rounded-md border border-border bg-white px-4 py-3">
          Invoice created successfully. Use the download buttons above to export as PDF or Peppol BIS 3.0 UBL XML.
          The PDF and UBL downloads require the dev bypass header — use the API directly for authenticated downloads.
        </p>
      </main>
    </div>
  );
}
