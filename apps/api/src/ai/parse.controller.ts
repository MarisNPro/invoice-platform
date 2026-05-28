import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { AiService } from './ai.service';

// ── Request DTO ───────────────────────────────────────────────────────────────

class ParseInvoiceBodyDto {
  /** Natural-language description of the invoice */
  @IsString()
  @IsNotEmpty()
  text!: string;
}

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * Public endpoint that parses a natural-language invoice description into
 * structured EN 16931 / Peppol BIS 3.0 field values using Claude AI.
 *
 * No authentication required — the endpoint is rate-limited by the underlying
 * Anthropic quota and should be fronted by an API gateway in production.
 *
 * POST /api/v1/invoices/parse
 * Body: { "text": "Invoice Nokia for 40 hours consulting at 120 EUR 21% VAT" }
 */
@Controller('invoices')
export class ParseController {
  constructor(private readonly ai: AiService) {}

  @Post('parse')
  @Public()
  @HttpCode(HttpStatus.OK)
  parse(@Body() dto: ParseInvoiceBodyDto) {
    return this.ai.parseNaturalLanguageInvoice(dto.text);
  }
}
