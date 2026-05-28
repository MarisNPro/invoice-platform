'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useForm,
  useFieldArray,
  useWatch,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  apiGetBlob,
  apiPost,
  type ImportRecord,
  type ImportConfidence,
  type ConfirmResult,
} from '@/lib/api';
import { cn, round2, fmtMoney } from '@/lib/utils';

// ── Zod schema ────────────────────────────────────────────────────────────────

const lineSchema = z.object({
  itemName:       z.string().min(1, 'Required'),
  quantity:       z.coerce.number().min(0),
  unitCode:       z.string().min(1),
  unitPrice:      z.coerce.number().min(0),
  vatRatePercent: z.coerce.number().min(0).max(100),
});

const reviewSchema = z.object({
  customerName:      z.string().optional(),
  customerVatNumber: z.string().optional(),
  currency:          z.string().length(3),
  issueDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines:             z.array(lineSchema).min(1, 'At least one line required'),
  note:              z.string().optional(),
});

type ReviewForm = z.infer<typeof reviewSchema>;

// ── Constants ─────────────────────────────────────────────────────────────────

const UNIT_CODES = ['HUR', 'DAY', 'PCS', 'ANN', 'MON', 'KGM', 'MTR', 'LTR', 'EA'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'CHF'];
const VAT_RATES  = [0, 5, 9, 10, 12, 14, 19, 20, 21, 22, 23, 25, 27];

// ── Style helpers ─────────────────────────────────────────────────────────────

const baseCls = cn(
  'flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm',
  'text-foreground placeholder:text-muted-foreground',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
);

function fieldCls(score: number) {
  if (score >= 0.8) return cn(baseCls, 'border-success/40');
  return cn(baseCls, 'border-amber-500/60 bg-amber-500/5 focus-visible:ring-amber-500/50');
}

const sectionCls   = 'rounded-xl border border-border bg-card overflow-hidden';
const sHeadCls     = 'flex items-center justify-between px-5 py-3.5 border-b border-border';
const sTitleCls    = 'text-sm font-semibold tracking-wide text-foreground';

// ── Sub-components ────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </span>
  );
}

function ConfBadge({ score }: { score: number }) {
  if (score >= 0.8) {
    return (
      <span className="mt-1 flex items-center gap-1 text-[10px] text-success">
        <span>✓</span>
        <span>{Math.round(score * 100)}% confidence</span>
      </span>
    );
  }
  return (
    <span className="mt-1 flex items-center gap-1 text-[10px] text-amber-400">
      <span>⚠</span>
      <span>{score.toFixed(2)} — please verify</span>
    </span>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  importId:    string;
  initialData: ImportRecord;
}

export function ReviewClient({ importId, initialData }: Props) {
  const router = useRouter();

  const [pdfUrl,       setPdfUrl]       = useState<string | null>(null);
  const [pdfLoading,   setPdfLoading]   = useState(true);
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const [rejectBusy,   setRejectBusy]   = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  const ext  = initialData.extractedData;
  const conf = ext?.confidence ?? ({ overall: 1, customer: 1, amounts: 1, dates: 1, vatRate: 1 } as ImportConfidence);

  // ── Load PDF as blob URL ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPdfLoading(true);
    apiGetBlob(`/imports/${importId}/pdf`)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setPdfUrl(url);
      })
      .catch(() => { if (!cancelled) setPdfUrl(null); })
      .finally(() => { if (!cancelled) setPdfLoading(false); });
    return () => {
      cancelled = true;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [importId]);

  // ── Form ─────────────────────────────────────────────────────────────────
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReviewForm>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      customerName:      ext?.customerName      ?? '',
      customerVatNumber: ext?.customerVatNumber ?? '',
      currency:          ext?.currency          ?? 'EUR',
      issueDate:         ext?.issueDate         ?? '',
      dueDate:           ext?.dueDate           ?? '',
      note:              ext?.note              ?? '',
      lines: ext?.lines?.map((l) => ({
        itemName:       l.itemName,
        quantity:       l.quantity,
        unitCode:       l.unitCode,
        unitPrice:      l.unitPrice,
        vatRatePercent: l.vatRatePercent,
      })) ?? [{ itemName: '', quantity: 1, unitCode: 'HUR', unitPrice: 0, vatRatePercent: 21 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const watchedLines = useWatch({ control, name: 'lines' });

  const totals = watchedLines.reduce(
    (acc, l) => {
      const net = round2((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0));
      const vat = round2(net * ((Number(l.vatRatePercent) || 0) / 100));
      return { subtotal: acc.subtotal + net, vat: acc.vat + vat };
    },
    { subtotal: 0, vat: 0 },
  );
  const grandTotal = round2(totals.subtotal + totals.vat);

  // ── Confirm ──────────────────────────────────────────────────────────────
  const onConfirm: SubmitHandler<ReviewForm> = async (data) => {
    setSubmitError(null);
    try {
      const result = await apiPost<ConfirmResult>(`/imports/${importId}/confirm`, {
        customerName:      data.customerName      || undefined,
        customerVatNumber: data.customerVatNumber || undefined,
        currency:          data.currency,
        issueDate:         data.issueDate,
        dueDate:           data.dueDate,
        note:              data.note              || undefined,
        lines:             data.lines.map((l) => ({
          itemName:       l.itemName,
          quantity:       Number(l.quantity),
          unitCode:       l.unitCode,
          unitPrice:      Number(l.unitPrice),
          vatRatePercent: Number(l.vatRatePercent),
        })),
      });
      router.push(`/invoices/${result.invoiceNumber}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unexpected error');
    }
  };

  // ── Reject ───────────────────────────────────────────────────────────────
  async function handleReject() {
    if (!confirm('Reject this import? It will be marked as failed.')) return;
    setRejectBusy(true);
    try {
      await apiPost(`/imports/${importId}/reject`, {});
      router.push('/');
    } catch {
      setRejectBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div data-theme="dark" className="flex h-screen flex-col bg-background text-foreground">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-5">
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Imports
            </button>
            <span className="text-border">/</span>
            <span className="max-w-[220px] truncate font-medium">
              {initialData.fileName}
            </span>
          </div>

          <div className="flex items-center gap-2.5 text-xs">
            {initialData.needsReview ? (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-medium text-amber-400">
                ⚠ Needs Review
              </span>
            ) : (
              <span className="rounded-full bg-success/15 px-2.5 py-0.5 font-medium text-success">
                ✓ High Confidence
              </span>
            )}
            <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground tabular-nums">
              {Math.round((conf.overall) * 100)}% overall
            </span>
          </div>
        </div>
      </header>

      {/* ── Split view ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT — PDF viewer ──────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border bg-[#0a0a0c]">
          <div className="shrink-0 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            PDF Document
          </div>
          <div className="relative flex-1 overflow-hidden">
            {pdfLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            {!pdfLoading && !pdfUrl && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                PDF unavailable
              </div>
            )}
            {pdfUrl && (
              <iframe
                src={pdfUrl}
                className="h-full w-full border-0"
                title="Invoice PDF"
              />
            )}
          </div>
        </div>

        {/* ── RIGHT — Review form ─────────────────────────────────────────── */}
        <div className="flex w-[520px] shrink-0 flex-col overflow-hidden">

          {/* Scrollable form content */}
          <div className="flex-1 overflow-y-auto">
            <form
              id="review-form"
              onSubmit={handleSubmit(onConfirm)}
              className="space-y-4 p-4"
            >

              {/* ── Customer ────────────────────────────────────────────── */}
              <div className={sectionCls}>
                <div className={sHeadCls}>
                  <span className={sTitleCls}>Customer</span>
                  <ConfBadge score={conf.customer} />
                </div>
                <div className="grid grid-cols-2 gap-4 p-5">
                  <div className="col-span-2 sm:col-span-1">
                    <Label>Company Name</Label>
                    <input
                      {...register('customerName')}
                      placeholder="Customer name"
                      className={fieldCls(conf.customer)}
                    />
                    {errors.customerName && (
                      <p className="mt-1 text-[11px] text-destructive">{errors.customerName.message}</p>
                    )}
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Label>VAT Number</Label>
                    <input
                      {...register('customerVatNumber')}
                      placeholder="e.g. FI12345678"
                      className={fieldCls(conf.customer)}
                    />
                  </div>
                </div>
              </div>

              {/* ── Invoice details ──────────────────────────────────────── */}
              <div className={sectionCls}>
                <div className={sHeadCls}>
                  <span className={sTitleCls}>Invoice Details</span>
                  <ConfBadge score={Math.min(conf.dates, conf.overall)} />
                </div>
                <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
                  <div>
                    <Label>Issue Date</Label>
                    <input
                      type="date"
                      {...register('issueDate')}
                      className={fieldCls(conf.dates)}
                    />
                    <ConfBadge score={conf.dates} />
                    {errors.issueDate && (
                      <p className="mt-1 text-[11px] text-destructive">{errors.issueDate.message}</p>
                    )}
                  </div>
                  <div>
                    <Label>Due Date</Label>
                    <input
                      type="date"
                      {...register('dueDate')}
                      className={fieldCls(conf.dates)}
                    />
                    <ConfBadge score={conf.dates} />
                    {errors.dueDate && (
                      <p className="mt-1 text-[11px] text-destructive">{errors.dueDate.message}</p>
                    )}
                  </div>
                  <div>
                    <Label>Currency</Label>
                    {/* Currency is always certain — extracted as 3-char code */}
                    <select {...register('currency')} className={fieldCls(1)}>
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── Line items ───────────────────────────────────────────── */}
              <div className={sectionCls}>
                <div className={sHeadCls}>
                  <span className={sTitleCls}>Line Items</span>
                  <div className="flex items-center gap-3">
                    <ConfBadge score={Math.min(conf.amounts, conf.vatRate)} />
                    <button
                      type="button"
                      onClick={() => append({ itemName: '', quantity: 1, unitCode: 'HUR', unitPrice: 0, vatRatePercent: 21 })}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      + Add line
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {['#', 'Description', 'Qty', 'Unit', 'Unit Price', 'VAT %', 'Net'].map((h, i) => (
                          <th
                            key={h}
                            className={cn(
                              'py-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground',
                              i === 0 ? 'w-8 px-4 text-left' :
                              i === 1 ? 'px-3 text-left' :
                              i === 6 ? 'w-24 px-3 pr-4 text-right' :
                              'w-20 px-3 text-right',
                            )}
                          >
                            {h}
                          </th>
                        ))}
                        <th className="w-9 px-2 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, idx) => {
                        const line = watchedLines[idx];
                        const net  = round2((Number(line?.quantity) || 0) * (Number(line?.unitPrice) || 0));
                        return (
                          <tr
                            key={field.id}
                            className="border-b border-border/50 last:border-0 hover:bg-muted/10"
                          >
                            <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>

                            <td className="px-3 py-2">
                              <input
                                {...register(`lines.${idx}.itemName`)}
                                placeholder="Description"
                                className={cn(
                                  fieldCls(conf.amounts),
                                  errors.lines?.[idx]?.itemName ? 'border-destructive' : '',
                                )}
                              />
                            </td>

                            <td className="px-3 py-2">
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                {...register(`lines.${idx}.quantity`)}
                                className={cn(fieldCls(conf.amounts), 'text-right')}
                              />
                            </td>

                            <td className="px-3 py-2">
                              <select
                                {...register(`lines.${idx}.unitCode`)}
                                className={fieldCls(conf.amounts)}
                              >
                                {UNIT_CODES.map((u) => (
                                  <option key={u} value={u}>{u}</option>
                                ))}
                              </select>
                            </td>

                            <td className="px-3 py-2">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                {...register(`lines.${idx}.unitPrice`)}
                                className={cn(fieldCls(conf.amounts), 'text-right')}
                              />
                            </td>

                            <td className="px-3 py-2">
                              <select
                                {...register(`lines.${idx}.vatRatePercent`)}
                                className={fieldCls(conf.vatRate)}
                              >
                                {VAT_RATES.map((r) => (
                                  <option key={r} value={r}>{r}%</option>
                                ))}
                              </select>
                            </td>

                            <td className="px-3 pr-4 py-2 text-right font-medium tabular-nums text-foreground">
                              {fmtMoney(net)}
                            </td>

                            <td className="px-2 py-2">
                              {fields.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => remove(idx)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                                >
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="flex justify-end border-t border-border px-5 py-4">
                  <dl className="w-56 space-y-1.5 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <dt>Subtotal</dt>
                      <dd className="tabular-nums">{fmtMoney(totals.subtotal)}</dd>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <dt>VAT</dt>
                      <dd className="tabular-nums">{fmtMoney(totals.vat)}</dd>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2 font-semibold">
                      <dt>Total</dt>
                      <dd className="tabular-nums text-primary">{fmtMoney(grandTotal)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* ── Notes ────────────────────────────────────────────────── */}
              <div className={sectionCls}>
                <div className={sHeadCls}>
                  <span className={sTitleCls}>Notes</span>
                </div>
                <div className="p-5">
                  <Label>Invoice Note <span className="normal-case text-[10px]">(BT-22)</span></Label>
                  <textarea
                    {...register('note')}
                    rows={3}
                    placeholder="Payment terms, instructions…"
                    className={cn(baseCls, 'h-auto resize-none py-2 text-sm leading-relaxed')}
                  />
                </div>
              </div>

              {/* Validation summary */}
              {Object.keys(errors).length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-xs text-destructive">
                  <strong>Fix the highlighted fields before confirming.</strong>
                </div>
              )}

            </form>
          </div>

          {/* ── Bottom action bar ──────────────────────────────────────────── */}
          <div className="shrink-0 border-t border-border bg-card px-4 py-3.5">

            {/* needsReview banner */}
            {initialData.needsReview && (
              <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-400">
                <strong>⚠ Low-confidence fields are highlighted in amber.</strong>
                {' '}Review and correct them before confirming.
              </div>
            )}

            {/* Error */}
            {submitError && (
              <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-[11px] text-destructive">
                {submitError}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleReject}
                disabled={rejectBusy || isSubmitting}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium',
                  'text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                {rejectBusy ? <Spinner className="h-3.5 w-3.5" /> : null}
                Reject
              </button>

              <button
                type="submit"
                form="review-form"
                disabled={isSubmitting || rejectBusy}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md px-5 text-sm font-semibold',
                  'bg-primary text-primary-foreground transition-all hover:bg-primary/90',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                {isSubmitting ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" />
                    Creating Invoice…
                  </>
                ) : (
                  'Confirm & Create Invoice'
                )}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
