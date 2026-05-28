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
}
