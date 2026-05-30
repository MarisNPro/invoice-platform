'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiGet, type InvoiceListResponse, type ContactResult } from '@/lib/api';
import { cn, fmtMoney, getFlag } from '@/lib/utils';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUSES = ['', 'DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
const STATUS_LABELS: Record<string, string> = {
  '': 'All statuses', DRAFT: 'Draft', SENT: 'Sent', PAID: 'Paid',
  OVERDUE: 'Overdue', CANCELLED: 'Cancelled',
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'bg-muted text-muted-foreground',
  SENT:      'bg-blue-500/15 text-blue-400',
  PAID:      'bg-success/15 text-success',
  OVERDUE:   'bg-destructive/15 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground',
  VOID:      'bg-muted text-muted-foreground',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const inputCls = cn(
  'h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground',
  'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  'transition-colors',
);

// ── Component ─────────────────────────────────────────────────────────────────

function InvoicesContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  // Read filters from URL
  const [status,    setStatus]    = useState(searchParams.get('status')    ?? '');
  const [buyerId,   setBuyerId]   = useState(searchParams.get('buyerId')   ?? '');
  const [from,      setFrom]      = useState(searchParams.get('from')      ?? '');
  const [to,        setTo]        = useState(searchParams.get('to')        ?? '');
  const [minAmount, setMinAmount] = useState(searchParams.get('minAmount') ?? '');
  const [maxAmount, setMaxAmount] = useState(searchParams.get('maxAmount') ?? '');

  const [invoices,  setInvoices]  = useState<InvoiceListResponse | null>(null);
  const [contacts,  setContacts]  = useState<ContactResult[]>([]);
  const [loading,   setLoading]   = useState(true);

  // Push filters to URL so they survive refresh
  const pushUrl = useCallback((overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { status, buyerId, from, to, minAmount, maxAmount, ...overrides };
    Object.entries(merged).forEach(([k, v]) => { if (v) p.set(k, v); });
    router.replace(`/invoices?${p.toString()}`, { scroll: false });
  }, [status, buyerId, from, to, minAmount, maxAmount, router]);

  // Fetch contacts once for the customer dropdown
  useEffect(() => {
    apiGet<ContactResult[]>('/contacts?isCustomer=true&limit=200')
      .then(setContacts)
      .catch(() => {});
  }, []);

  // Fetch invoices whenever filters change
  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (status)    q.set('status',    status);
    if (buyerId)   q.set('buyerId',   buyerId);
    if (from)      q.set('from',      from);
    if (to)        q.set('to',        to);
    if (minAmount) q.set('minAmount', minAmount);
    if (maxAmount) q.set('maxAmount', maxAmount);
    q.set('limit', '100');

    apiGet<InvoiceListResponse>(`/invoices?${q.toString()}`)
      .then(setInvoices)
      .catch(() => setInvoices(null))
      .finally(() => setLoading(false));
  }, [status, buyerId, from, to, minAmount, maxAmount]);

  function clearFilters() {
    setStatus(''); setBuyerId(''); setFrom(''); setTo('');
    setMinAmount(''); setMaxAmount('');
    router.replace('/invoices', { scroll: false });
  }

  const hasFilters = !!(status || buyerId || from || to || minAmount || maxAmount);

  return (
    <div data-theme="dark" className="min-h-screen bg-background text-foreground">

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="text-muted-foreground hover:text-foreground">← Dashboard</Link>
            <span className="text-border">/</span>
            <span className="font-medium">Invoices</span>
          </div>
          <Link
            href="/invoices/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            + New Invoice
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">

        {/* Filter bar */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">

            {/* Status */}
            <div className="min-w-[140px]">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); pushUrl({ status: e.target.value }); }}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                ))}
              </select>
            </div>

            {/* Customer */}
            <div className="min-w-[200px]">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Customer</label>
              <select
                value={buyerId}
                onChange={(e) => { setBuyerId(e.target.value); pushUrl({ buyerId: e.target.value }); }}
                className={inputCls}
              >
                <option value="">All customers</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Date from */}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); pushUrl({ from: e.target.value }); }}
                className={inputCls}
              />
            </div>

            {/* Date to */}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); pushUrl({ to: e.target.value }); }}
                className={inputCls}
              />
            </div>

            {/* Min amount */}
            <div className="w-28">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Min €</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={minAmount}
                placeholder="0"
                onChange={(e) => { setMinAmount(e.target.value); pushUrl({ minAmount: e.target.value }); }}
                className={inputCls}
              />
            </div>

            {/* Max amount */}
            <div className="w-28">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Max €</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={maxAmount}
                placeholder="∞"
                onChange={(e) => { setMaxAmount(e.target.value); pushUrl({ maxAmount: e.target.value }); }}
                className={inputCls}
              />
            </div>

            {/* Clear */}
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 self-end rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Results summary */}
        {!loading && invoices && (
          <p className="text-xs text-muted-foreground">
            {invoices.meta.total} invoice{invoices.meta.total !== 1 ? 's' : ''}
            {hasFilters ? ' matching filters' : ''}
          </p>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : !invoices || invoices.data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm font-medium">No invoices found</p>
              {hasFilters ? (
                <button type="button" onClick={clearFilters} className="mt-2 text-xs text-primary hover:underline">
                  Clear filters
                </button>
              ) : (
                <Link href="/invoices/new" className="mt-2 text-xs text-primary hover:underline">
                  Create your first invoice
                </Link>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Invoice #', 'Customer', 'Status', 'Issued', 'Due', 'Amount', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.data.map((inv) => (
                  <tr key={inv.id} className="border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3.5">
                      <Link href={`/invoices/${inv.id}`} className="font-mono text-sm text-primary hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link href={`/customers/${inv.buyer.id}`} className="flex items-center gap-1.5 hover:text-primary transition-colors">
                        <span>{getFlag(inv.buyer.country)}</span>
                        <span>{inv.buyer.name}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT)}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-xs text-muted-foreground">{fmtDate(inv.issuedAt)}</td>
                    <td className="px-4 py-3.5 tabular-nums text-xs text-muted-foreground">{fmtDate(inv.dueAt)}</td>
                    <td className="px-4 py-3.5 tabular-nums font-medium">
                      {inv.currencyCode} {fmtMoney(Number(inv.total))}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link href={`/invoices/${inv.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

// useSearchParams() must be read inside a Suspense boundary (Next.js App Router),
// otherwise the page de-opts to client-side rendering and the build errors.
export default function InvoicesPage() {
  return (
    <Suspense
      fallback={
        <div
          data-theme="dark"
          className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
        >
          Loading…
        </div>
      }
    >
      <InvoicesContent />
    </Suspense>
  );
}
