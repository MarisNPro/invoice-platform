import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ElasticsearchModule } from './common/elasticsearch/elasticsearch.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { InvoiceModule } from './invoice/invoice.module';
import { CompanyModule } from './company/company.module';
import { ContactModule } from './contact/contact.module';

@Module({
  imports: [
    // Config — loads .env, available everywhere
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env', '.env.local', '.env'],
      cache: true,
    }),

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
  ],
  controllers: [HealthController],
})
export class AppModule {}
