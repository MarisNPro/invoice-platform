'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useForm,
  useFieldArray,
  useWatch,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { CompanyAutocomplete, type AutocompleteOption } from '@/components/CompanyAutocomplete';
import { apiPost, type CreatedInvoice, type ParsedInvoiceResponse } from '@/lib/api';
import { cn, round2, fmtMoney, getFlag } from '@/lib/utils';

// ── Zod schema ────────────────────────────────────────────────────────────────

const lineSchema = z.object({
  itemName:       z.string().min(1, 'Description required'),
  quantity:       z.coerce.number({ invalid_type_error: 'Required' }).min(0),
  unitCode:       z.string().min(1),
  unitPrice:      z.coerce.number({ invalid_type_error: 'Required' }).min(0),
  vatRatePercent: z.coerce.number({ invalid_type_error: 'Required' }).min(0).max(100),
});

const invoiceSchema = z.object({
  customerId:       z.string().min(1, 'Select a customer'),
  currency:         z.string().length(3),
  language:         z.string().optional(),
  issueDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines:            z.array(lineSchema).min(1),
  note:             z.string().optional(),
  paymentTermsNote: z.string().optional(),
});

type FormValues = z.infer<typeof invoiceSchema>;

// ── Constants ─────────────────────────────────────────────────────────────────

const UNIT_CODES = ['HUR', 'DAY', 'PCS', 'ANN', 'MON', 'KGM', 'MTR', 'LTR', 'EA'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'CHF'];
const LANGUAGES  = ['en', 'lv', 'lt', 'et', 'fi', 'de', 'fr', 'sv'];
const VAT_RATES  = [0, 5, 9, 10, 12, 14, 19, 20, 21, 22, 23, 25, 27];

const DEFAULT_LINE = {
  itemName: '', quantity: 1, unitCode: 'HUR', unitPrice: 0, vatRatePercent: 21,
};

function today()                { return new Date().toISOString().slice(0, 10); }
function addDays(d: string, n: number) {
  const dt = new Date(d); dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

// ── Customer info ─────────────────────────────────────────────────────────────

interface CustomerInfo {
  name: string; vatNumber?: string; country: string; email?: string; isContact: boolean;
}

// ── Shared input style tokens ─────────────────────────────────────────────────

const inputCls = cn(
  'flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm',
  'text-foreground placeholder:text-muted-foreground',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
);

const sectionCls = 'rounded-xl border border-border bg-card overflow-hidden';
const sectionHeadCls = 'flex items-center justify-between px-5 py-3.5 border-b border-border';
const sectionTitleCls = 'text-sm font-semibold tracking-wide text-foreground';

// ── Label ─────────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvoiceForm() {
  const router = useRouter();
  const [customer,      setCustomer]      = useState<CustomerInfo | null>(null);
  const [submitError,   setSubmitError]   = useState<string | null>(null);
  const [nlpText,       setNlpText]       = useState('');
  const [nlpLoading,    setNlpLoading]    = useState(false);
  const [nlpResult,     setNlpResult]     = useState<ParsedInvoiceResponse | null>(null);
  const [nlpError,      setNlpError]      = useState<string | null>(null);
  const nlpRef = useRef<HTMLTextAreaElement>(null);

  const issueDate = today();

  const {
    register,
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      customerId: '', currency: 'EUR', language: 'en',
      issueDate, dueDate: addDays(issueDate, 30),
      lines: [{ ...DEFAULT_LINE }],
      note: '', paymentTermsNote: '30 days net',
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });

  // Live totals
  const watchedLines = useWatch({ control, name: 'lines' });
  const totals = useMemo(() => {
    const subtotal = watchedLines.reduce(
      (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0,
    );
    const vat = watchedLines.reduce((s, l) => {
      const net = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      return s + net * ((Number(l.vatRatePercent) || 0) / 100);
    }, 0);
    return { subtotal: round2(subtotal), vat: round2(vat), total: round2(subtotal + vat) };
  }, [watchedLines]);

  // ── AI autofill ───────────────────────────────────────────────────────────

  async function handleNlpAutofill() {
    if (!nlpText.trim()) return;
    setNlpLoading(true);
    setNlpError(null);
    setNlpResult(null);
    try {
      const result = await apiPost<ParsedInvoiceResponse>('/invoices/parse', {
        text: nlpText.trim(),
      });
      setNlpResult(result);

      // Fill form fields from parsed data
      const p = result.parsed;
      if (p.issueDate) setValue('issueDate', p.issueDate);
      if (p.dueDate)   setValue('dueDate', p.dueDate);
      if (p.currency)  setValue('currency', p.currency);
      if (p.note)      setValue('note', p.note);
      if (p.lines?.length) {
        replace(
          p.lines.map((l) => ({
            itemName:       l.itemName,
            quantity:       l.quantity,
            unitCode:       l.unitCode,
            unitPrice:      l.unitPrice,
            vatRatePercent: l.vatRatePercent,
          })),
        );
      }
    } catch (err) {
      setNlpError(err instanceof Error ? err.message : 'AI parse failed');
    } finally {
      setNlpLoading(false);
    }
  }

  // ── Customer select ───────────────────────────────────────────────────────

  const handleCompanySelect = useCallback(
    (opt: AutocompleteOption | null) => {
      if (!opt) { setCustomer(null); setValue('customerId', '', { shouldValidate: true }); return; }
      if (opt.kind === 'contact' && opt.id) {
        setValue('customerId', opt.id, { shouldValidate: true });
        setCustomer({ name: opt.name, vatNumber: opt.vatNumber, country: opt.country, email: opt.email, isContact: true });
      } else {
        setValue('customerId', '', { shouldValidate: false });
        setCustomer({ name: opt.name, vatNumber: opt.vatNumber, country: opt.country, isContact: false });
      }
    },
    [setValue],
  );

  // ── Submit ────────────────────────────────────────────────────────────────

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setSubmitError(null);
    try {
      const invoice = await apiPost<CreatedInvoice>('/invoices', {
        customerId:       data.customerId,
        currency:         data.currency,
        language:         data.language || undefined,
        issueDate:        data.issueDate,
        dueDate:          data.dueDate,
        lines:            data.lines.map((l) => ({
          itemName:       l.itemName,
          quantity:       Number(l.quantity),
          unitCode:       l.unitCode,
          unitPrice:      Number(l.unitPrice),
          vatRatePercent: Number(l.vatRatePercent),
        })),
        note:             data.note || undefined,
        paymentTermsNote: data.paymentTermsNote || undefined,
      });
      router.push(`/invoices/${invoice.id}`);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Unexpected error');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

      {/* ══ 1. AI autofill ═══════════════════════════════════════════════════ */}
      <div className={sectionCls}>
        <div className={sectionHeadCls}>
          <span className={sectionTitleCls}>
            <span className="mr-2 text-primary">✦</span>AI Autofill
          </span>
          <span className="text-[11px] text-muted-foreground">
            Describe your invoice, Claude fills the form
          </span>
        </div>
        <div className="p-5 space-y-3">
          <textarea
            ref={nlpRef}
            value={nlpText}
            onChange={(e) => setNlpText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleNlpAutofill(); } }}
            placeholder='e.g. "Invoice Nokia for 40 hours consulting at 120 EUR, 21% VAT, due in 30 days"'
            rows={2}
            className={cn(
              inputCls,
              'h-auto resize-none py-2.5 text-sm leading-relaxed',
            )}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {nlpResult && (
                <span className="text-success">
                  ✓ Filled {Object.keys(nlpResult.parsed).length} fields
                  &nbsp;·&nbsp;confidence {Math.round(nlpResult.parsed.confidence.overall * 100)}%
                </span>
              )}
              {nlpError && <span className="text-destructive">{nlpError}</span>}
              {!nlpResult && !nlpError && (
                <span>⌘↵ to auto-fill</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleNlpAutofill}
              disabled={!nlpText.trim() || nlpLoading}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {nlpLoading ? (
                <>
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Parsing…
                </>
              ) : (
                <><span>✦</span> Auto-fill</>
              )}
            </button>
          </div>

          {/* Resolver hint */}
          {nlpResult?.notes?.map((n, i) => (
            <p key={i} className="text-[11px] text-muted-foreground bg-muted/50 rounded px-3 py-1.5">
              {n}
            </p>
          ))}
        </div>
      </div>

      {/* ══ 2. Customer ══════════════════════════════════════════════════════ */}
      <div className={sectionCls}>
        <div className={sectionHeadCls}>
          <span className={sectionTitleCls}>Customer</span>
          {customer && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="text-base leading-none">{getFlag(customer.country)}</span>
              <span className="font-medium text-foreground">{customer.name}</span>
              {customer.isContact
                ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">✓ Customer</span>
                : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">Registry only</span>
              }
            </span>
          )}
        </div>
        <div className="p-5 space-y-3">
          <CompanyAutocomplete
            onSelect={handleCompanySelect}
            value={customer?.name}
            error={errors.customerId?.message}
          />

          {customer && !customer.isContact && (
            <p className="rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-400">
              This company isn&apos;t in your contacts yet — add them as a customer to create an invoice.
            </p>
          )}

          <input type="hidden" {...register('customerId')} />
        </div>
      </div>

      {/* ══ 3. Invoice details ════════════════════════════════════════════════ */}
      <div className={sectionCls}>
        <div className={sectionHeadCls}>
          <span className={sectionTitleCls}>Invoice Details</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {/* Issue date */}
            <div>
              <Label>Issue Date *</Label>
              <input type="date" {...register('issueDate')} className={inputCls} />
              {errors.issueDate && <p className="mt-1 text-[11px] text-destructive">{errors.issueDate.message}</p>}
            </div>
            {/* Due date */}
            <div>
              <Label>Due Date *</Label>
              <input type="date" {...register('dueDate')} className={inputCls} />
              {errors.dueDate && <p className="mt-1 text-[11px] text-destructive">{errors.dueDate.message}</p>}
            </div>
            {/* Currency */}
            <div>
              <Label>Currency</Label>
              <select {...register('currency')} className={inputCls}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {/* Language */}
            <div>
              <Label>Language</Label>
              <select {...register('language')} className={inputCls}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ══ 4. Line items ════════════════════════════════════════════════════ */}
      <div className={sectionCls}>
        <div className={sectionHeadCls}>
          <span className={sectionTitleCls}>Line Items</span>
          <button
            type="button"
            onClick={() => append({ ...DEFAULT_LINE })}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            + Add line
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-8 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">#</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Description</th>
                <th className="w-20 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Qty</th>
                <th className="w-20 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Unit</th>
                <th className="w-28 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Unit Price</th>
                <th className="w-20 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">VAT %</th>
                <th className="w-28 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Net Amt</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, idx) => {
                const line = watchedLines[idx];
                const net  = round2((Number(line?.quantity) || 0) * (Number(line?.unitPrice) || 0));
                return (
                  <tr
                    key={field.id}
                    className="border-b border-border/50 transition-colors hover:bg-muted/20 last:border-0"
                  >
                    <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>

                    <td className="px-3 py-2">
                      <input
                        placeholder="Service or product description"
                        {...register(`lines.${idx}.itemName`)}
                        className={cn(inputCls, errors.lines?.[idx]?.itemName ? 'border-destructive' : '')}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        type="number" step="0.001" min="0"
                        className={cn(inputCls, 'text-right')}
                        {...register(`lines.${idx}.quantity`)}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <select {...register(`lines.${idx}.unitCode`)} className={inputCls}>
                        {UNIT_CODES.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>

                    <td className="px-3 py-2">
                      <input
                        type="number" step="0.01" min="0"
                        className={cn(inputCls, 'text-right')}
                        {...register(`lines.${idx}.unitPrice`)}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <select {...register(`lines.${idx}.vatRatePercent`)} className={inputCls}>
                        {VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </td>

                    <td className="px-3 py-2 text-right font-medium tabular-nums text-foreground">
                      {fmtMoney(net)}
                    </td>

                    <td className="px-2 py-2">
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(idx)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                          title="Remove"
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
          <dl className="w-60 space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <dt>Subtotal <span className="text-[10px]">(BT-106)</span></dt>
              <dd className="tabular-nums">{fmtMoney(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <dt>Total VAT <span className="text-[10px]">(BT-110)</span></dt>
              <dd className="tabular-nums">{fmtMoney(totals.vat)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold text-foreground">
              <dt>Grand Total <span className="text-[10px] font-normal text-muted-foreground">(BT-112)</span></dt>
              <dd className="tabular-nums text-primary">{fmtMoney(totals.total)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* ══ 5. Notes ══════════════════════════════════════════════════════════ */}
      <div className={sectionCls}>
        <div className={sectionHeadCls}>
          <span className={sectionTitleCls}>Notes</span>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div>
            <Label>Payment Terms <span className="normal-case text-[10px]">(BT-20)</span></Label>
            <input
              placeholder="e.g. 30 days net"
              {...register('paymentTermsNote')}
              className={inputCls}
            />
          </div>
          <div>
            <Label>Invoice Note <span className="normal-case text-[10px]">(BT-22)</span></Label>
            <textarea
              placeholder="Additional notes visible on the invoice…"
              rows={2}
              className={cn(inputCls, 'h-auto resize-none py-2')}
              {...register('note')}
            />
          </div>
        </div>
      </div>

      {/* ══ 6. Actions bar ════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-3.5">
        <p className="text-sm">
          {customer?.isContact
            ? <span className="font-medium text-success">✓ Ready to save</span>
            : <span className="text-muted-foreground">Select an existing customer to save</span>
          }
        </p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!customer?.isContact || isSubmitting}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-md px-5 text-sm font-semibold',
              'bg-primary text-primary-foreground hover:bg-primary/90 transition-all',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            {isSubmitting ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Saving…
              </>
            ) : 'Save as Draft'}
          </button>
        </div>
      </div>

      {/* Submit error */}
      {submitError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          <strong>Error: </strong>{submitError}
        </div>
      )}
    </form>
  );
}
