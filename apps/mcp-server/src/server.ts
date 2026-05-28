/**
 * MCP server factory.
 *
 * Call createMcpServer(orgId, isReadOnly) to get a fresh McpServer instance
 * scoped to a single SSE connection.  Each SSE connection gets its own
 * instance so that orgId / isReadOnly are baked in per-connection.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeApiClient } from './api-client.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Wrap a tool handler so write-only tools return a clear refusal when
 *  the key is read-only. */
function guardWrite(isReadOnly: boolean, name: string): string | null {
  if (isReadOnly) {
    return `Tool "${name}" is not available with a read-only API key (prefix "ro_").`;
  }
  return null;
}

/** Format a value as a markdown-style text content block. */
function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

function json(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

function errorText(msg: string) {
  return { isError: true, content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
}

// ── factory ───────────────────────────────────────────────────────────────────

export function createMcpServer(orgId: string, isReadOnly: boolean): McpServer {
  const api    = makeApiClient(orgId);
  const server = new McpServer({
    name:    'invoice-platform',
    version: '0.1.0',
  });

  // ── Tool 1: create_invoice ─────────────────────────────────────────────────
  server.tool(
    'create_invoice',
    'Create a new invoice. Provide a natural-language description; the AI will parse it and submit the invoice.',
    {
      description: z.string().min(10).describe(
        'Natural language description of the invoice, e.g. "Invoice €1 200 to Acme Corp for 3 days consulting at €400/day, due in 30 days"',
      ),
      customerName: z.string().optional().describe('Override customer name'),
    },
    async ({ description, customerName }) => {
      const deny = guardWrite(isReadOnly, 'create_invoice');
      if (deny) return errorText(deny);

      try {
        // Step 1 — NLP parse
        const { data: parsed } = await api.post<{
          parsed: {
            customerName?: string;
            currency: string;
            issueDate: string;
            dueDate: string;
            lines: Array<{
              itemName: string;
              quantity: number;
              unitPrice: number;
              vatRatePercent: number;
              unitCode: string;
            }>;
            note?: string;
          };
          missingRequiredFields: string[];
        }>('/invoices/parse', { text: description });

        const resolvedName = customerName ?? parsed.parsed.customerName;

        // Step 2 — look up contact (best-effort)
        let customerId: string | undefined;
        if (resolvedName) {
          try {
            const { data: contacts } = await api.get<Array<{ id: string }>>('/contacts', {
              params: { search: resolvedName, isCustomer: true, limit: 1 },
            });
            if (contacts.length > 0) customerId = contacts[0]!.id;
          } catch {
            // non-fatal
          }
        }

        // Step 3 — create invoice
        const body: Record<string, unknown> = {
          currency:    parsed.parsed.currency,
          issueDate:   parsed.parsed.issueDate,
          dueDate:     parsed.parsed.dueDate,
          note:        parsed.parsed.note,
          lines:       parsed.parsed.lines.map((l) => ({
            itemName:      l.itemName,
            quantity:      l.quantity,
            unitPrice:     l.unitPrice,
            vatRatePercent: l.vatRatePercent,
            unitCode:      l.unitCode,
          })),
        };
        if (customerId) body.customerId = customerId;
        if (resolvedName && !customerId) body.buyerName = resolvedName;

        const { data: invoice } = await api.post<{
          id: string;
          number: string;
          status: string;
          total: number;
          currencyCode: string;
        }>('/invoices', body);

        return text(
          `✅ Invoice created!\n\n` +
          `Number : ${invoice.number}\n` +
          `Status : ${invoice.status}\n` +
          `Total  : ${invoice.total} ${invoice.currencyCode}\n` +
          `ID     : ${invoice.id}\n\n` +
          (parsed.missingRequiredFields.length > 0
            ? `⚠️  Missing fields: ${parsed.missingRequiredFields.join(', ')}\n`
            : ''),
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Failed to create invoice: ${msg}`);
      }
    },
  );

  // ── Tool 2: list_invoices ──────────────────────────────────────────────────
  server.tool(
    'list_invoices',
    'List invoices, optionally filtered by status.',
    {
      status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']).optional()
        .describe('Filter by invoice status'),
      limit: z.number().int().min(1).max(100).default(20)
        .describe('Maximum number of invoices to return (default 20)'),
    },
    async ({ status, limit }) => {
      try {
        const params: Record<string, unknown> = { limit };
        if (status) params.status = status;
        const { data } = await api.get<unknown[]>('/invoices', { params });
        return json(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Failed to list invoices: ${msg}`);
      }
    },
  );

  // ── Tool 3: get_invoice ────────────────────────────────────────────────────
  server.tool(
    'get_invoice',
    'Get a single invoice by its ID or invoice number.',
    {
      idOrNumber: z.string().describe('Invoice UUID or invoice number (e.g. INV-2024-0042)'),
    },
    async ({ idOrNumber }) => {
      try {
        // Try direct UUID GET first, fall back to list+filter
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
        if (isUuid) {
          const { data } = await api.get<unknown>(`/invoices/${idOrNumber}`);
          return json(data);
        }
        // Search by number
        const { data: list } = await api.get<Array<{ number: string; id: string }>>('/invoices', {
          params: { limit: 200 },
        });
        const found = list.find((i) => i.number === idOrNumber);
        if (!found) return errorText(`Invoice "${idOrNumber}" not found.`);
        const { data } = await api.get<unknown>(`/invoices/${found.id}`);
        return json(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Failed to get invoice: ${msg}`);
      }
    },
  );

  // ── Tool 4: send_invoice ───────────────────────────────────────────────────
  server.tool(
    'send_invoice',
    'Mark an invoice as sent (transitions status from DRAFT → SENT).',
    {
      idOrNumber: z.string().describe('Invoice UUID or invoice number'),
    },
    async ({ idOrNumber }) => {
      const deny = guardWrite(isReadOnly, 'send_invoice');
      if (deny) return errorText(deny);

      try {
        const id = await resolveInvoiceId(api, idOrNumber);
        const { data } = await api.patch<{ id: string; number: string; status: string }>(`/invoices/${id}/send`);
        return text(`✅ Invoice ${data.number} marked as SENT (status: ${data.status})`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Failed to send invoice: ${msg}`);
      }
    },
  );

  // ── Tool 5: mark_paid ─────────────────────────────────────────────────────
  server.tool(
    'mark_paid',
    'Mark an invoice as paid.',
    {
      idOrNumber: z.string().describe('Invoice UUID or invoice number'),
      paidAt:     z.string().optional().describe('ISO date when payment was received (defaults to today)'),
    },
    async ({ idOrNumber, paidAt }) => {
      const deny = guardWrite(isReadOnly, 'mark_paid');
      if (deny) return errorText(deny);

      try {
        const id   = await resolveInvoiceId(api, idOrNumber);
        const body: Record<string, unknown> = {};
        if (paidAt) body.paidAt = paidAt;
        const { data } = await api.patch<{ id: string; number: string; status: string }>(`/invoices/${id}/pay`, body);
        return text(`✅ Invoice ${data.number} marked as PAID (status: ${data.status})`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Failed to mark invoice as paid: ${msg}`);
      }
    },
  );

  // ── Tool 6: search_companies ───────────────────────────────────────────────
  server.tool(
    'search_companies',
    'Search the public company registry for a company by name, registration number, or VAT number.',
    {
      query:   z.string().min(2).describe('Company name, reg number, or VAT number'),
      country: z.string().length(2).optional().describe('ISO-3166-1 alpha-2 country code filter, e.g. "FI"'),
      limit:   z.number().int().min(1).max(20).default(6).describe('Max results'),
    },
    async ({ query, country, limit }) => {
      try {
        const params: Record<string, unknown> = { q: query, limit };
        if (country) params.country = country;
        const { data } = await api.get<unknown[]>('/companies/search', { params });
        return json(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Company search failed: ${msg}`);
      }
    },
  );

  // ── Tool 7: list_customers ─────────────────────────────────────────────────
  server.tool(
    'list_customers',
    'List all saved customer contacts.',
    {
      search: z.string().optional().describe('Optional name / VAT filter'),
      limit:  z.number().int().min(1).max(100).default(50).describe('Max results'),
    },
    async ({ search, limit }) => {
      try {
        const params: Record<string, unknown> = { isCustomer: true, limit };
        if (search) params.search = search;
        const { data } = await api.get<unknown[]>('/contacts', { params });
        return json(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Failed to list customers: ${msg}`);
      }
    },
  );

  // ── Tool 8: get_summary ────────────────────────────────────────────────────
  server.tool(
    'get_summary',
    'Get a financial summary: total outstanding, overdue, and paid this month.',
    {},
    async () => {
      try {
        const { data: invoices } = await api.get<Array<{
          status: string;
          total: number;
          currencyCode: string;
          dueAt?: string;
          paidAt?: string;
        }>>('/invoices', { params: { limit: 500 } });

        const now        = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        let outstanding = 0;
        let overdue     = 0;
        let paidMonth   = 0;
        const currencies = new Set<string>();

        for (const inv of invoices) {
          currencies.add(inv.currencyCode);
          if (inv.status === 'SENT' || inv.status === 'OVERDUE') {
            outstanding += inv.total;
            if (inv.dueAt && inv.dueAt < now.toISOString()) overdue += inv.total;
          }
          if (inv.status === 'PAID' && inv.paidAt && inv.paidAt >= monthStart) {
            paidMonth += inv.total;
          }
        }

        const summary = {
          totalInvoices:       invoices.length,
          outstandingAmount:   outstanding,
          overdueAmount:       overdue,
          paidThisMonth:       paidMonth,
          currencies:          [...currencies],
          breakdown: {
            DRAFT:     invoices.filter((i) => i.status === 'DRAFT').length,
            SENT:      invoices.filter((i) => i.status === 'SENT').length,
            PAID:      invoices.filter((i) => i.status === 'PAID').length,
            OVERDUE:   invoices.filter((i) => i.status === 'OVERDUE').length,
            CANCELLED: invoices.filter((i) => i.status === 'CANCELLED').length,
          },
        };

        return json(summary);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Failed to get summary: ${msg}`);
      }
    },
  );

  // ── Tool 9: get_overdue ────────────────────────────────────────────────────
  server.tool(
    'get_overdue',
    'List all overdue invoices (SENT status with a past due date).',
    {
      limit: z.number().int().min(1).max(100).default(50).describe('Max results'),
    },
    async ({ limit }) => {
      try {
        const { data: invoices } = await api.get<Array<{
          id: string;
          number: string;
          status: string;
          total: number;
          currencyCode: string;
          dueAt?: string;
          buyer?: { name: string };
        }>>('/invoices', { params: { status: 'SENT', limit: 500 } });

        const now     = new Date().toISOString();
        const overdue = invoices
          .filter((i) => i.dueAt && i.dueAt < now)
          .slice(0, limit);

        if (overdue.length === 0) {
          return text('✅ No overdue invoices — all caught up!');
        }

        const lines = overdue.map((i) => {
          const days = i.dueAt
            ? Math.floor((Date.now() - new Date(i.dueAt).getTime()) / 86_400_000)
            : 0;
          return `• ${i.number}  ${i.total} ${i.currencyCode}  ${i.buyer?.name ?? 'Unknown'}  (${days}d overdue)`;
        });

        return text(`⚠️  ${overdue.length} overdue invoice(s):\n\n${lines.join('\n')}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorText(`Failed to get overdue invoices: ${msg}`);
      }
    },
  );

  // ── Prompt 1: /new-invoice ─────────────────────────────────────────────────
  server.prompt(
    'new-invoice',
    'Start the invoice creation flow — asks for customer and line items.',
    {
      customerHint: z.string().optional().describe('Optional customer name or partial info'),
    },
    ({ customerHint }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: customerHint
              ? `I need to create a new invoice for ${customerHint}. Please use the create_invoice tool to help me. Ask me for any missing details (line items, amounts, due date).`
              : `I need to create a new invoice. Please use the create_invoice tool to help me. Start by asking who the customer is and what services or products are being invoiced.`,
          },
        },
      ],
    }),
  );

  // ── Prompt 2: /check-overdue ───────────────────────────────────────────────
  server.prompt(
    'check-overdue',
    'Check for overdue invoices and suggest follow-up actions.',
    {},
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please check my overdue invoices using the get_overdue tool and then summarise the situation. For each overdue invoice suggest whether I should send a payment reminder or escalate. Group them by urgency (< 7 days, 7–30 days, > 30 days overdue).`,
          },
        },
      ],
    }),
  );

  // ── Prompt 3: /monthly-summary ─────────────────────────────────────────────
  server.prompt(
    'monthly-summary',
    'Generate a monthly financial summary with insights.',
    {
      month: z.string().optional().describe('Month in YYYY-MM format (defaults to current month)'),
    },
    ({ month }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please generate a monthly financial summary${month ? ` for ${month}` : ' for this month'}. Use the get_summary tool to fetch the data, then present it in a clear executive-summary format: total revenue collected, outstanding receivables, overdue risk, and the top 3 action items I should take this week.`,
          },
        },
      ],
    }),
  );

  return server;
}

// ── Utility ───────────────────────────────────────────────────────────────────

async function resolveInvoiceId(
  api: ReturnType<typeof makeApiClient>,
  idOrNumber: string,
): Promise<string> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
  if (isUuid) return idOrNumber;

  const { data: list } = await api.get<Array<{ number: string; id: string }>>('/invoices', {
    params: { limit: 200 },
  });
  const found = list.find((i) => i.number === idOrNumber);
  if (!found) throw new Error(`Invoice "${idOrNumber}" not found`);
  return found.id;
}
