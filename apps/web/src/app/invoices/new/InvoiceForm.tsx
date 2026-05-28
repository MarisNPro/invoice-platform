'use client';

import { useCallback, useMemo, useState } from 'react';
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
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Select }  from '@/components/ui/select';
import { Badge }   from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { apiPost, type CreatedInvoice } from '@/lib/api';
import { round2, fmtMoney, getFlag } from '@/lib/utils';

// ── Zod schema ────────────────────────────────────────────────────────────────

const lineSchema = z.object({
  itemName:      z.string().min(1, 'Description is required'),
  quantity:      z.coerce.number({ invalid_type_error: 'Required' }).min(0, 'Must be ≥ 0'),
  unitCode:      z.string().min(1, 'Required'),
  unitPrice:     z.coerce.number({ invalid_type_error: 'Required' }).min(0, 'Must be ≥ 0'),
  vatRatePercent: z.coerce.number({ invalid_type_error: 'Required' }).min(0).max(100),
});

const invoiceSchema = z.object({
  customerId:       z.string().min(1, 'Select a customer'),
  currency:         z.string().length(3),
  language:         z.string().optional(),
  issueDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  dueDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  lines:            z.array(lineSchema).min(1, 'Add at least one line item'),
  note:             z.string().optional(),
  paymentTermsNote: z.string().optional(),
});

type FormValues = z.infer<typeof invoiceSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const DEFAULT_LINE = {
  itemName:       '',
  quantity:       1,
  unitCode:       'HUR',
  unitPrice:      0,
  vatRatePercent: 21,
};

const UNIT_CODES = ['HUR', 'DAY', 'PCS', 'ANN', 'MON', 'KGM', 'MTR', 'LTR'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK'];
const LANGUAGES  = ['en', 'lv', 'lt', 'et', 'fi', 'de', 'fr'];
const VAT_RATES  = [0, 5, 9, 10, 12, 14, 19, 20, 21, 22, 23, 25, 27];

// ── Customer display state ────────────────────────────────────────────────────

interface CustomerInfo {
  name:       string;
  vatNumber?: string;
  country:    string;
  email?:     string;
  isContact:  boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvoiceForm() {
  const router = useRouter();
  const [customer,    setCustomer]    = useState<CustomerInfo | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const issueDate = today();

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      customerId:       '',
      currency:         'EUR',
      language:         'en',
      issueDate,
      dueDate:          addDays(issueDate, 30),
      lines:            [{ ...DEFAULT_LINE }],
      note:             '',
      paymentTermsNote: '30 days net',
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  // Live totals
  const watchedLines = useWatch({ control, name: 'lines' });
  const totals = useMemo(() => {
    const subtotal = watchedLines.reduce((s, l) => {
      return s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
    }, 0);
    const vat = watchedLines.reduce((s, l) => {
      const net = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      return s + net * ((Number(l.vatRatePercent) || 0) / 100);
    }, 0);
    return { subtotal: round2(subtotal), vat: round2(vat), total: round2(subtotal + vat) };
  }, [watchedLines]);

  // Handle company autocomplete selection
  const handleCompanySelect = useCallback(
    (opt: AutocompleteOption | null) => {
      if (!opt) {
        setCustomer(null);
        setValue('customerId', '', { shouldValidate: true });
        return;
      }
      if (opt.kind === 'contact' && opt.id) {
        setValue('customerId', opt.id, { shouldValidate: true });
        setCustomer({
          name:       opt.name,
          vatNumber:  opt.vatNumber,
          country:    opt.country,
          email:      opt.email,
          isContact:  true,
        });
      } else {
        // Registry result — fills display fields but can't submit without UUID
        setValue('customerId', '', { shouldValidate: false });
        setCustomer({
          name:      opt.name,
          vatNumber: opt.vatNumber,
          country:   opt.country,
          isContact: false,
        });
      }
    },
    [setValue],
  );

  // Submit
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
      setSubmitError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

      {/* ── Section 1: Customer ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CompanyAutocomplete
            onSelect={handleCompanySelect}
            value={customer?.name}
            error={errors.customerId?.message}
          />

          {/* Customer info card */}
          {customer && (
            <div className={`rounded-md border p-3 text-sm ${customer.isContact ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{getFlag(customer.country)}</span>
                    <span className="font-semibold">{customer.name}</span>
                    {customer.isContact
                      ? <Badge variant="success">✓ Customer</Badge>
                      : <Badge variant="outline" className="border-amber-400 text-amber-700">Registry result</Badge>
                    }
                  </div>
                  {customer.vatNumber && (
                    <p className="text-muted-foreground">VAT: {customer.vatNumber}</p>
                  )}
                  {customer.email && (
                    <p className="text-muted-foreground">{customer.email}</p>
                  )}
                  {!customer.isContact && (
                    <p className="text-amber-700 text-xs mt-1">
                      This company is not in your contacts yet. Add them as a customer first to create an invoice.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Hidden customerId input (registered for react-hook-form) */}
          <input type="hidden" {...register('customerId')} />
          {errors.customerId && !customer && (
            <p className="text-xs text-destructive">{errors.customerId.message}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Section 2: Invoice metadata ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {/* Issue date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Issue Date *
              </label>
              <Input type="date" {...register('issueDate')} />
              {errors.issueDate && (
                <p className="text-xs text-destructive">{errors.issueDate.message}</p>
              )}
            </div>

            {/* Due date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Due Date *
              </label>
              <Input type="date" {...register('dueDate')} />
              {errors.dueDate && (
                <p className="text-xs text-destructive">{errors.dueDate.message}</p>
              )}
            </div>

            {/* Currency */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Currency
              </label>
              <Select {...register('currency')}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>

            {/* Language */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Language
              </label>
              <Select {...register('language')}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 3: Line items ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Line Items</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ ...DEFAULT_LINE })}
            >
              + Add line
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground w-8">#</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Description (BT-153)</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground w-20">Qty</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-20">Unit</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground w-28">Unit Price</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground w-20">VAT %</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground w-28">Net Amount</th>
                  <th className="px-2 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((field, idx) => {
                  const line = watchedLines[idx];
                  const net  = round2((Number(line?.quantity) || 0) * (Number(line?.unitPrice) || 0));
                  return (
                    <tr key={field.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>

                      {/* Description */}
                      <td className="px-3 py-2">
                        <Input
                          placeholder="Service or product description"
                          {...register(`lines.${idx}.itemName`)}
                          className={errors.lines?.[idx]?.itemName ? 'border-destructive' : ''}
                        />
                      </td>

                      {/* Quantity */}
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          className="text-right"
                          {...register(`lines.${idx}.quantity`)}
                        />
                      </td>

                      {/* Unit code */}
                      <td className="px-3 py-2">
                        <Select {...register(`lines.${idx}.unitCode`)}>
                          {UNIT_CODES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </Select>
                      </td>

                      {/* Unit price */}
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="text-right"
                          {...register(`lines.${idx}.unitPrice`)}
                        />
                      </td>

                      {/* VAT % */}
                      <td className="px-3 py-2">
                        <Select {...register(`lines.${idx}.vatRatePercent`)}>
                          {VAT_RATES.map((r) => (
                            <option key={r} value={r}>{r}%</option>
                          ))}
                        </Select>
                      </td>

                      {/* Net amount (live) */}
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {fmtMoney(net)}
                      </td>

                      {/* Delete */}
                      <td className="px-2 py-2">
                        {fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => remove(idx)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            title="Remove line"
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

          {errors.lines?.root && (
            <p className="px-5 py-2 text-xs text-destructive">{errors.lines.root.message}</p>
          )}

          {/* ── Live totals ───────────────────────────────────────────────── */}
          <div className="flex justify-end px-5 py-4 border-t border-border">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal (BT-106)</span>
                <span className="tabular-nums">{fmtMoney(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Total VAT (BT-110)</span>
                <span className="tabular-nums">{fmtMoney(totals.vat)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold text-base">
                <span>Grand Total (BT-112)</span>
                <span className="tabular-nums text-primary">{fmtMoney(totals.total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 4: Notes ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Payment Terms (BT-20)
            </label>
            <Input placeholder="e.g. 30 days net" {...register('paymentTermsNote')} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Invoice Note (BT-22)
            </label>
            <textarea
              placeholder="Additional notes visible on the invoice…"
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors resize-none"
              {...register('note')}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Actions bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-5 py-3">
        <div className="text-sm text-muted-foreground">
          {customer?.isContact
            ? <span className="text-green-700">✓ Ready to save</span>
            : <span>Select an existing customer to enable save</span>
          }
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={!customer?.isContact}
          >
            Save as Draft
          </Button>
        </div>
      </div>

      {/* Submit error */}
      {submitError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <strong>Error:</strong> {submitError}
        </div>
      )}
    </form>
  );
}
