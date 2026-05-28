import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

// ── Model ─────────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-6';

// ── Shared system prompt (the cached portion) ─────────────────────────────────
// Kept large on purpose — the more stable text is in the cached block, the
// higher the cache-hit ratio and the lower the cost per call.

const SYSTEM_PROMPT = `\
You are an EU invoice data extraction specialist with deep knowledge of:
- EN 16931 (European standard for electronic invoicing — CEN/TC 434)
- Peppol BIS Billing 3.0 (Pan-European Public Procurement OnLine)
- Council Directive 2006/112/EC (EU VAT Directive)
- UN/CEFACT Recommendation 20 (unit of measure codes)

━━━ EN 16931 BUSINESS TERMS (BT) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BT-2   Issue date — date the invoice was created (YYYY-MM-DD)
BT-5   Currency — ISO 4217 three-letter code (EUR, USD, GBP, SEK …)
BT-9   Due date — date by which payment must be received
BT-22  Invoice note — free-text additional information for the buyer
BT-23  Process type — Peppol process identifier (set by system)
BT-24  Specification — EN 16931 specification identifier (set by system)
BG-4   Buyer — the party being invoiced (customer)
BG-7   Seller — the party issuing the invoice (your company)
BG-25  Invoice lines — one entry per product or service
  BT-129  Invoiced quantity
  BT-130  Unit of measure code (UN/CEFACT Rec 20):
            HUR  = hours          (consulting, labour, support)
            DAY  = days           (daily rates)
            PCS  = pieces/units   (products, licences)
            ANN  = per year
            MON  = months
            KGM  = kilograms
            MTR  = metres
            LTR  = litres
            SET  = set
            EA   = each
  BT-146  Item net price (unit price, excluding VAT)
  BT-152  VAT rate as a percentage (e.g. 21, 25, 20, 19 …)
  BT-153  Item name / description

━━━ EU VAT STANDARD RATES (2024) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AT 20 % | BE 21 % | BG 20 % | CY 19 % | CZ 21 % | DE 19 %
DK 25 % | EE 22 % | ES 21 % | FI 25.5% | FR 20 % | GR 24 %
HR 25 % | HU 27 % | IE 23 % | IT 22 % | LT 21 % | LU 17 %
LV 21 % | MT 18 % | NL 21 % | PL 23 % | PT 23 % | RO 19 %
SE 25 % | SI 22 % | SK 20 %

Reduced rates (9 % or 10 %): food, books, medicines, accommodation.
Zero rate (0 %): intra-EU B2B supplies, exports, specific exemptions.
Reverse charge: buyer is a VAT-registered business in another EU member state.

When the country of the buyer is not identifiable and no VAT rate is stated,
default to 21 % (most common EU standard rate).

━━━ EXTRACTION RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Extract the buyer/customer name if any company or person is mentioned.
2. For "X hours at Y EUR/hour" → quantity=X, unitPrice=Y, unitCode="HUR".
3. For "X days at Y EUR/day" → quantity=X, unitPrice=Y, unitCode="DAY".
4. For unit price: if only a total is given and quantity>1, derive unit price.
5. Currency defaults to EUR unless explicitly stated otherwise.
6. If issue date is absent, use today's date.
7. If due date is absent, default to 30 days after the issue date.
8. Assign numeric confidence scores (0.0–1.0) for each field group.
   0.0 = guessed / missing,  0.5 = inferred,  1.0 = explicitly stated.
9. Always call the extract_invoice tool — never reply in plain text.`;

// ── Structured-output tool ────────────────────────────────────────────────────

const EXTRACT_INVOICE_TOOL: Anthropic.Messages.Tool = {
  name: 'extract_invoice',
  description:
    'Extract structured invoice data from natural language text following ' +
    'EN 16931 and Peppol BIS Billing 3.0 standards. Always call this tool.',
  input_schema: {
    type: 'object',
    properties: {
      customerName: {
        type: 'string',
        description: 'Buyer / customer company or person name (BG-4)',
      },
      customerVatNumber: {
        type: 'string',
        description: 'Buyer VAT registration number if mentioned (BT-48)',
      },
      currency: {
        type: 'string',
        description: 'ISO 4217 currency code, e.g. "EUR" (BT-5)',
      },
      issueDate: {
        type: 'string',
        description:
          'Invoice issue date in YYYY-MM-DD format (BT-2). Use today if not stated.',
      },
      dueDate: {
        type: 'string',
        description:
          'Payment due date in YYYY-MM-DD format (BT-9). Default: +30 days from issueDate.',
      },
      lines: {
        type: 'array',
        description: 'Invoice lines (BG-25) — at least one required',
        items: {
          type: 'object',
          properties: {
            itemName: {
              type: 'string',
              description: 'Item description (BT-153)',
            },
            quantity: {
              type: 'number',
              description: 'Invoiced quantity (BT-129)',
            },
            unitPrice: {
              type: 'number',
              description: 'Net unit price excluding VAT (BT-146)',
            },
            vatRatePercent: {
              type: 'number',
              description:
                'VAT rate as a percentage, e.g. 21 for 21% (BT-152). Default to 21 if unknown.',
            },
            unitCode: {
              type: 'string',
              description:
                'UN/CEFACT Rec 20 unit code (BT-130). ' +
                'HUR=hours, DAY=days, PCS=pieces, ANN=annual, MON=months.',
            },
          },
          required: ['itemName', 'quantity', 'unitPrice', 'vatRatePercent', 'unitCode'],
        },
        minItems: 1,
      },
      note: {
        type: 'string',
        description: 'Optional free-text invoice note (BT-22)',
      },
      confidence: {
        type: 'object',
        description: 'Confidence scores 0.0–1.0 for each extracted field group',
        properties: {
          overall: {
            type: 'number',
            description: 'Weighted overall confidence',
          },
          customer: {
            type: 'number',
            description: 'Confidence that the customer name is correct',
          },
          amounts: {
            type: 'number',
            description: 'Confidence in quantities and unit prices',
          },
          dates: {
            type: 'number',
            description: 'Confidence in issue / due dates',
          },
          vatRate: {
            type: 'number',
            description: 'Confidence in the VAT rate applied',
          },
        },
        required: ['overall', 'customer', 'amounts', 'dates', 'vatRate'],
      },
    },
    required: ['currency', 'issueDate', 'dueDate', 'lines', 'confidence'],
  },
};

// ── Public types ──────────────────────────────────────────────────────────────

export interface ParsedInvoiceLine {
  itemName: string;
  quantity: number;
  unitPrice: number;
  vatRatePercent: number;
  unitCode: string;
}

export interface ParsedInvoice {
  customerName?: string;
  customerVatNumber?: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  lines: ParsedInvoiceLine[];
  note?: string;
  confidence: {
    overall: number;
    customer: number;
    amounts: number;
    dates: number;
    vatRate: number;
  };
}

export interface ParseUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface ParseInvoiceResult {
  /** Structured invoice data extracted from the text */
  parsed: ParsedInvoice;
  /** Required fields still missing that the caller must supply before creating the invoice */
  missingRequiredFields: string[];
  /** Human-readable hints about the extraction */
  notes: string[];
  /** Token usage (useful for monitoring prompt cache efficiency) */
  usage: ParseUsage;
}

// ── Review system prompt (separate cached block for review calls) ─────────────

const REVIEW_SYSTEM_PROMPT = `\
You are a senior EU invoicing compliance auditor. Your job is to review invoices
against EN 16931 (European electronic invoicing standard) and Peppol BIS Billing 3.0.

━━━ CHECKS TO PERFORM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ARITHMETIC INTEGRITY
   - Each line: lineTotal = quantity × unitPrice (within 0.01 rounding tolerance)
   - Each line: lineTaxAmount = lineTotal × (vatRate / 100) (0.01 tolerance)
   - BG-22 subtotal = sum of all lineTotals
   - BG-22 taxAmount = sum of all lineTaxAmounts (and VAT breakdown amounts)
   - BG-22 total = subtotal + taxAmount
   - VAT breakdown: taxableAmount = sum of lineTotals for that rate
   - VAT breakdown: taxAmount = taxableAmount × (rate / 100)

2. MANDATORY FIELDS (EN 16931 §7.1)
   - BT-1  Invoice number must be present and non-empty
   - BT-2  Issue date must be present
   - BT-5  Currency code must be a valid ISO 4217 code (3 uppercase letters)
   - BT-9  Payment due date must be present
   - BT-27 Seller name must be present
   - BT-44 Buyer name must be present
   - BT-106 Sum of line net amounts must be present
   - BT-110 Total VAT amount must be present
   - BT-112 Invoice total with VAT must be present
   - At least one invoice line must be present

3. VAT CATEGORY CODES (EN 16931 §6.4.1 — BT-118)
   - S (Standard rate): rate > 0 — must match a EU standard rate for the country
   - Z (Zero-rated):    rate = 0 — valid for exports, specific exemptions
   - E (Exempt):        rate = 0 — must have exemption reason (BT-120)
   - AE (Reverse charge): rate = 0 — used for intra-EU B2B supplies
   - Warn if S rate appears unusual for the buyer's country (e.g. 21% for FI where
     standard is 25.5%, 19% for EE where standard is 22%)

4. DATE REASONABLENESS
   - Due date must be on or after issue date
   - Warn if due date is > 180 days after issue date (unusually long terms)
   - Warn if issue date is more than 30 days in the past (possible backdating)
   - Warn if issue date is in the future (pre-invoicing)

5. DUPLICATE / QUALITY RISKS
   - Warn if any line description is empty, very short (< 3 chars), or generic
     (e.g. "test", "item", "product")
   - Warn if any unit price is 0 (is this intentional?)
   - Warn if quantity is negative (credit lines should be on a credit note, BT-3 = 381)
   - Info: note if note/payment-terms are empty (nice to have)

━━━ SEVERITY LEVELS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
error   — blocks processing; invoice MUST be corrected before sending
warning — should be reviewed; may cause rejection at Peppol network level
info    — best-practice recommendation; invoice is valid but could be improved

━━━ APPROVED DEFINITION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
approved = true  if there are zero "error" severity issues
approved = false if there is at least one "error" severity issue
(warnings and infos do not prevent approval)

Always call the review_invoice tool. Never reply in plain text.`;

// ── Review tool ───────────────────────────────────────────────────────────────

const REVIEW_INVOICE_TOOL: Anthropic.Messages.Tool = {
  name: 'review_invoice',
  description:
    'Return a structured EN 16931 compliance review for the given invoice.',
  input_schema: {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        description: 'List of compliance issues found. Empty array if none.',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description:
                'The EN 16931 field or section involved, e.g. "BT-9 dueDate", "BG-22 subtotal", "line 2 vatRate"',
            },
            severity: {
              type: 'string',
              enum: ['error', 'warning', 'info'],
              description: 'error = must fix | warning = should fix | info = nice to fix',
            },
            message: {
              type: 'string',
              description: 'Human-readable explanation of the issue',
            },
          },
          required: ['field', 'severity', 'message'],
        },
      },
      suggestions: {
        type: 'array',
        description: 'Actionable improvement suggestions (strings). Max 5.',
        items: { type: 'string' },
      },
      approved: {
        type: 'boolean',
        description: 'true if zero error-severity issues; false otherwise',
      },
      confidence: {
        type: 'number',
        description:
          '0.0–1.0 confidence in the review. Lower when data is ambiguous.',
      },
    },
    required: ['issues', 'suggestions', 'approved', 'confidence'],
  },
};

// ── Review input / output types ───────────────────────────────────────────────

export interface ReviewableLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  taxAmount: number;
  vatRatePercent?: number;  // derived from taxRate.rate if available
}

export interface ReviewableVatBreakdown {
  vatCategoryCode: string;
  vatRatePercent: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface ReviewableInvoice {
  number: string;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: number;
  taxAmount: number;
  total: number;
  seller: { name: string; vatNumber?: string | null; businessId?: string | null; country?: string | null };
  buyer:  { name: string; vatNumber?: string | null; businessId?: string | null; country?: string | null };
  lines: ReviewableLine[];
  vatBreakdowns: ReviewableVatBreakdown[];
  note?: string | null;
  paymentTermsNote?: string | null;
}

export interface ReviewIssue {
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface InvoiceReviewResult {
  issues: ReviewIssue[];
  suggestions: string[];
  approved: boolean;
  confidence: number;
  usage: ParseUsage;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY') ?? '',
    });
  }

  /**
   * Parse a natural-language invoice description into structured EN 16931
   * field values. Uses prompt caching on the system message (via the beta
   * prompt-caching API) and forces a structured output via tool use.
   *
   * @example
   *   await ai.parseNaturalLanguageInvoice(
   *     'Invoice Nokia for 40 hours consulting at 120 EUR 21% VAT'
   *   );
   */
  async parseNaturalLanguageInvoice(text: string): Promise<ParseInvoiceResult> {
    this.logger.debug(`Parsing invoice text (${text.length} chars)`);

    // Use the beta prompt-caching API so the system block can carry
    // cache_control, cutting token cost on repeated calls significantly.
    const response = await this.client.beta.promptCaching.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Marks this block for prompt caching — saved after first call,
          // subsequent calls skip re-tokenising ~1 k tokens of rules.
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [EXTRACT_INVOICE_TOOL],
      // Force the model to call exactly this tool (structured output).
      tool_choice: { type: 'tool', name: 'extract_invoice' },
      messages: [
        {
          role: 'user',
          content: `Extract invoice data from the following text:\n\n${text}`,
        },
      ],
    });

    // Find the tool-use block in the response
    const toolBlock = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );

    if (!toolBlock) {
      throw new Error(
        'Claude did not return a structured tool-use block. Raw response: ' +
          JSON.stringify(response.content),
      );
    }

    const parsed = toolBlock.input as ParsedInvoice;

    // Determine which required fields are still missing
    const missingRequiredFields: string[] = [];
    const notes: string[] = [];

    // customerId is always missing at this stage — the caller must resolve the
    // company name via GET /api/v1/contacts to obtain a UUID.
    missingRequiredFields.push('customerId');
    if (parsed.customerName) {
      notes.push(
        `Resolve customerId: GET /api/v1/contacts?search=${encodeURIComponent(parsed.customerName)}&isCustomer=true`,
      );
    } else {
      notes.push('Customer name not found in text — provide customerId manually.');
    }

    // Log cache efficiency
    const u = response.usage;
    const cacheRead   = u.cache_read_input_tokens   ?? 0;
    const cacheCreate = u.cache_creation_input_tokens ?? 0;
    if (cacheRead > 0) {
      this.logger.debug(`Prompt cache HIT — saved ${cacheRead} tokens`);
    } else if (cacheCreate > 0) {
      this.logger.debug(`Prompt cache MISS — created cache entry (${cacheCreate} tokens)`);
    }

    return {
      parsed,
      missingRequiredFields,
      notes,
      usage: {
        inputTokens:              u.input_tokens,
        outputTokens:             u.output_tokens,
        cacheReadInputTokens:     cacheRead,
        cacheCreationInputTokens: cacheCreate,
      },
    };
  }

  // ── reviewInvoice ─────────────────────────────────────────────────────────

  /**
   * Review an existing invoice for EN 16931 / Peppol BIS 3.0 compliance.
   * Returns a structured list of issues, suggestions, and an approval flag.
   *
   * Prompt caching is applied to the long system prompt so repeated review
   * calls (common in CI or pre-send validation flows) are cheap.
   */
  async reviewInvoice(invoice: ReviewableInvoice): Promise<InvoiceReviewResult> {
    this.logger.debug(`Reviewing invoice ${invoice.number}`);

    // ── Build readable invoice summary for the user message ─────────────────
    const toIso = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const fmt2  = (n: number) => Number(n).toFixed(2);

    const linesSummary = invoice.lines
      .map(
        (l) =>
          `  Line ${l.lineNumber}: "${l.description}" | ` +
          `qty=${l.quantity} ${l.unit} × ${fmt2(l.unitPrice)} = ${fmt2(l.lineTotal)} | ` +
          `tax=${fmt2(l.taxAmount)}` +
          (l.vatRatePercent !== undefined ? ` (${l.vatRatePercent}%)` : ''),
      )
      .join('\n');

    const vatSummary = invoice.vatBreakdowns
      .map(
        (vb) =>
          `  VAT ${vb.vatCategoryCode} ${vb.vatRatePercent}%: ` +
          `taxable=${fmt2(vb.taxableAmount)}, tax=${fmt2(vb.taxAmount)}`,
      )
      .join('\n');

    const invoiceSummary = `\
INVOICE: ${invoice.number}
Currency: ${invoice.currency}
Issue date: ${toIso(invoice.issueDate)}
Due date:   ${toIso(invoice.dueDate)}

SELLER: ${invoice.seller.name}
  VAT: ${invoice.seller.vatNumber ?? '(not set)'}
  Reg: ${invoice.seller.businessId ?? '(not set)'}
  Country: ${invoice.seller.country ?? '(unknown)'}

BUYER: ${invoice.buyer.name}
  VAT: ${invoice.buyer.vatNumber ?? '(not set)'}
  Reg: ${invoice.buyer.businessId ?? '(not set)'}
  Country: ${invoice.buyer.country ?? '(unknown)'}

LINES:
${linesSummary}

VAT BREAKDOWNS:
${vatSummary}

DOCUMENT TOTALS (BG-22):
  BT-106 Subtotal (sum of lines):   ${fmt2(invoice.subtotal)}
  BT-110 Total VAT:                 ${fmt2(invoice.taxAmount)}
  BT-112 Grand total (incl. VAT):   ${fmt2(invoice.total)}

NOTES:
  Payment terms (BT-20): ${invoice.paymentTermsNote ?? '(not set)'}
  Invoice note  (BT-22): ${invoice.note ?? '(not set)'}`;

    const response = await this.client.beta.promptCaching.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: REVIEW_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [REVIEW_INVOICE_TOOL],
      tool_choice: { type: 'tool', name: 'review_invoice' },
      messages: [
        {
          role: 'user',
          content: `Please review this invoice for EN 16931 compliance:\n\n${invoiceSummary}`,
        },
      ],
    });

    const toolBlock = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );

    if (!toolBlock) {
      throw new Error(
        'Claude did not return a review_invoice tool-use block. Response: ' +
          JSON.stringify(response.content),
      );
    }

    const result = toolBlock.input as {
      issues: ReviewIssue[];
      suggestions: string[];
      approved: boolean;
      confidence: number;
    };

    const u = response.usage;
    const cacheRead   = u.cache_read_input_tokens   ?? 0;
    const cacheCreate = u.cache_creation_input_tokens ?? 0;

    this.logger.log(
      `Review ${invoice.number}: approved=${result.approved}, ` +
      `issues=${result.issues.length}, cache=${cacheRead > 0 ? 'HIT' : 'MISS'}`,
    );

    return {
      ...result,
      usage: {
        inputTokens:              u.input_tokens,
        outputTokens:             u.output_tokens,
        cacheReadInputTokens:     cacheRead,
        cacheCreationInputTokens: cacheCreate,
      },
    };
  }
}
