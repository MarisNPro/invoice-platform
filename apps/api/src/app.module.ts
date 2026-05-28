import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ElasticsearchModule } from './common/elasticsearch/elasticsearch.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { InvoiceModule } from './invoice/invoice.module';
import { CompanyModule } from './company/company.module';
import { ContactModule } from './contact/contact.module';
import { AiModule } from './ai/ai.module';
import { OrganisationModule } from './organisation/organisation.module';
import { AdminModule } from './admin/admin.module';
import { ImportModule } from './import/import.module';
import { FastifyThrottlerGuard } from './common/fastify-throttler.guard';

@Module({
  imports: [
    // Config — loads .env, available everywhere
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env', '.env.local', '.env'],
      cache: true,
    }),

    // ── Rate limiting (global defaults; individual routes can override) ────
    // Default: 120 req / 60 s per IP.  The /invoices/parse endpoint overrides
    // to 10 req / 60 s because each call hits the Anthropic API.
    ThrottlerModule.forRoot([
      {
        name:  'default',
        ttl:   60_000, // ms — 60 seconds
        limit: 120,
      },
    ]),

    // HTTP client (axios wrapper)
    HttpModule.register({ timeout: 10_000, maxRedirects: 3 }),

    // Health checks
    TerminusModule,

    // Core modules
    PrismaModule,
    RedisModule,
    ElasticsearchModule,
    AuthModule,
    InvoiceModule,
    CompanyModule,
    ContactModule,
    AiModule,
    OrganisationModule,
    AdminModule,
    ImportModule,
  ],
  controllers: [HealthController],
  providers: [
    // Apply Fastify-aware rate limiting globally
    {
      provide:  APP_GUARD,
      useClass: FastifyThrottlerGuard,
    },
  ],
})
export class AppModule {}
