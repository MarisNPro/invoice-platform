import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import type { InvoiceListResponse } from '@/lib/api';
import { getFlag, fmtMoney } from '@/lib/utils';

export const metadata: Metadata = { title: 'Customer | Invoice Platform' };

interface Contact {
  id: string; name: string; vatNumber: string | null; businessId: string | null;
  country: string; email: string | null; phone: string | null;
  addresses: Array<{ street: string; city: string; postalCode: string; country: string; isDefault: boolean }>;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'bg-muted text-muted-foreground',
  SENT:      'bg-blue-500/15 text-blue-400',
  PAID:      'bg-success/15 text-success',
  OVERDUE:   'bg-destructive/15 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground',
  VOID:      'bg-muted text-muted-foreground',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let contact: Contact;
  try {
    contact = await apiGet<Contact>(`/contacts/${id}`);
  } catch {
    notFound();
  }

  const invoiceData = await apiGet<InvoiceListResponse>(`/invoices?buyerId=${id}&limit=50`);
  const invoices    = invoiceData.data;
  const addr        = contact.addresses.find((a) => a.isDefault) ?? contact.addresses[0];

  return (
    <div data-theme="dark" className="min-h-screen bg-background text-foreground">

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/customers" className="text-muted-foreground hover:text-foreground">← Customers</Link>
            <span className="text-border">/</span>
            <span className="flex items-center gap-1.5 font-medium">
              <span>{getFlag(contact.country)}</span>
              {contact.name}
            </span>
          </div>
          <Link
            href={`/invoices/new?customerId=${id}&customerName=${encodeURIComponent(contact.name)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            + New Invoice
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">

        {/* Customer details card */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Customer Details
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Company</p>
              <p className="mt-1 font-medium">{contact.name}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Country</p>
              <p className="mt-1">{getFlag(contact.country)} {contact.country}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">VAT Number</p>
              <p className="mt-1 font-mono text-sm">{contact.vatNumber ?? '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Reg. Number</p>
              <p className="mt-1 font-mono text-sm">{contact.businessId ?? '—'}</p>
            </div>
            {contact.email && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Email</p>
                <p className="mt-1 text-sm">{contact.email}</p>
              </div>
            )}
            {contact.phone && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Phone</p>
                <p className="mt-1 text-sm">{contact.phone}</p>
              </div>
            )}
            {addr && (
              <div className="col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Address</p>
                <p className="mt-1 text-sm">{addr.street}, {addr.city} {addr.postalCode}, {addr.country}</p>
              </div>
            )}
          </div>
        </div>

        {/* Invoice history */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Invoice History
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({invoices.length} invoice{invoices.length !== 1 ? 's' : ''})
              </span>
            </h2>
          </div>

          {invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12 text-center">
              <p className="text-sm text-muted-foreground">No invoices yet for this customer.</p>
              <Link
                href={`/invoices/new?customerId=${id}&customerName=${encodeURIComponent(contact.name)}`}
                className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Create first invoice
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {['Invoice #', 'Status', 'Issued', 'Due', 'Amount', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/50 last:border-0 hover:bg-muted/10">
                      <td className="px-4 py-3 font-mono text-sm">
                        <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground text-xs">{fmtDate(inv.issuedAt)}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground text-xs">{fmtDate(inv.dueAt)}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">
                        {inv.currencyCode} {fmtMoney(Number(inv.total))}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
