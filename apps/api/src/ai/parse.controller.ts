import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
 * Rate limit: 10 requests / 60 s per IP (overrides the global 120 req/60 s
 * default) because every call proxies to the Anthropic API and can be
 * computationally expensive.
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
  // 10 req / 60 s per IP — tighter than global default due to Anthropic API cost
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  parse(@Body() dto: ParseInvoiceBodyDto) {
    return this.ai.parseNaturalLanguageInvoice(dto.text);
  }
}
