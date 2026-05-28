import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { ImportService } from './import.service';
import { ExtractDto } from './dto/extract.dto';
import { ConfirmDto } from './dto/confirm.dto';

@Controller('imports')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  /**
   * POST /api/v1/imports/upload
   * Accepts multipart/form-data with a single "file" field (PDF only).
   * Uploads to MinIO and returns a fileId for subsequent extraction.
   */
  @Post('upload')
  async upload(
    @Req() req: FastifyRequest,
    @CurrentUser() user: JwtPayload,
  ) {
    // @fastify/multipart attaches file() to the request at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = await (req as any).file();
    if (!file) throw new BadRequestException('No file field in request');

    const allowed = ['application/pdf', 'application/octet-stream'];
    if (!allowed.includes(file.mimetype) && !file.filename?.endsWith('.pdf')) {
      throw new BadRequestException('Only PDF files are supported');
    }

    const buffer   = await file.toBuffer() as Buffer;
    const tenantId = user.tenant_id ?? '';

    return this.importService.upload(tenantId, buffer, file.filename as string, 'application/pdf');
  }

  /**
   * GET /api/v1/imports/:id
   * Returns the import archive record with extractedData and needsReview flag.
   */
  @Get(':id')
  getOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.importService.getOne(user.tenant_id ?? '', id);
  }

  /**
   * GET /api/v1/imports/:id/pdf
   * Streams the uploaded PDF from MinIO so the browser can display it.
   */
  @Get(':id/pdf')
  async getPdf(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { buffer, fileName } = await this.importService.getPdfBuffer(user.tenant_id ?? '', id);
    reply.header('Content-Disposition', `inline; filename="${fileName}"`);
    return new StreamableFile(buffer, { type: 'application/pdf' });
  }

  /**
   * POST /api/v1/imports/:id/reject
   * Marks the import as FAILED so it is excluded from further processing.
   */
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.importService.reject(user.tenant_id ?? '', id);
  }

  /**
   * POST /api/v1/imports/extract
   * Fetches the previously uploaded file from MinIO and runs Claude extraction.
   * Returns structured invoice data with per-field confidence scores and a
   * needsReview flag for the UI to decide whether to show a review step.
   */
  @Post('extract')
  extract(
    @Body() dto: ExtractDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.importService.extract(user.tenant_id ?? '', dto.fileId);
  }

  /**
   * POST /api/v1/imports/:importId/confirm
   * Converts the previously extracted import into a real DRAFT invoice.
   * Accepts optional field overrides; auto-creates the customer contact if
   * it does not yet exist. Returns the new invoice number.
   */
  @Post(':importId/confirm')
  confirm(
    @Param('importId') importId: string,
    @Body() dto: ConfirmDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.importService.confirm(user.tenant_id ?? '', importId, dto);
  }
}
