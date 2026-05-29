import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { CustomerListItem } from '@/lib/api';
import { getFlag, fmtMoney } from '@/lib/utils';

export const metadata: Metadata = { title: 'Customers | Invoice Platform' };

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default async function CustomersPage() {
  const customers = await apiGet<CustomerListItem[]>('/contacts/customers');

  return (
    <div data-theme="dark" className="min-h-screen bg-background text-foreground">

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">← Dashboard</Link>
            <span className="text-border">/</span>
            <span className="font-medium">Customers</span>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {customers.length} customer{customers.length !== 1 ? 's' : ''}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">All customer contacts with invoice history.</p>
        </div>

        {customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-20 text-center">
            <p className="text-lg font-semibold">No customers yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create an invoice to add a customer contact.</p>
            <Link
              href="/invoices/new"
              className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              + New Invoice
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Customer', 'VAT Number', 'Reg. Number', 'Invoices', 'Total Invoiced', 'Last Invoice', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 last:border-0 transition-colors hover:bg-muted/10">

                    <td className="px-4 py-3.5">
                      <Link href={`/customers/${c.id}`} className="flex items-center gap-2 group">
                        <span className="text-base leading-none">{getFlag(c.country)}</span>
                        <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                          {c.name}
                        </span>
                      </Link>
                      {c.email && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{c.email}</p>
                      )}
                    </td>

                    <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                      {c.vatNumber ?? '—'}
                    </td>

                    <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                      {c.businessId ?? '—'}
                    </td>

                    <td className="px-4 py-3.5 tabular-nums text-center">
                      {c.invoiceCount > 0 ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                          {c.invoiceCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 tabular-nums font-medium">
                      {c.totalInvoiced > 0 ? `€${fmtMoney(c.totalInvoiced)}` : '—'}
                    </td>

                    <td className="px-4 py-3.5 text-xs text-muted-foreground tabular-nums">
                      {fmtDate(c.lastInvoiceDate)}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/customers/${c.id}`}
                          className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          View
                        </Link>
                        <Link
                          href={`/invoices/new?customerId=${c.id}&customerName=${encodeURIComponent(c.name)}`}
                          className="inline-flex h-7 items-center rounded-md bg-primary/15 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/25"
                        >
                          + Invoice
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
