/**
 * Standalone sync runner — executes LV and/or LT bulk registry sync
 * without bringing up the full HTTP server.
 *
 * Usage (from apps/api):
 *   npx ts-node -r tsconfig-paths/register src/company/sync-runner.ts lv
 *   npx ts-node -r tsconfig-paths/register src/company/sync-runner.ts lt
 *   npx ts-node -r tsconfig-paths/register src/company/sync-runner.ts all
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchModule } from '../common/elasticsearch/elasticsearch.module';
import { CompanySyncService } from './company-sync.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env', '.env'],
    }),
    ElasticsearchModule,
  ],
  providers: [CompanySyncService],
})
class SyncModule {}

async function bootstrap() {
  const target = (process.argv[2] ?? 'all').toLowerCase();
  const app = await NestFactory.createApplicationContext(SyncModule, { logger: ['log', 'warn', 'error'] });
  const svc = app.get(CompanySyncService);

  if (target === 'lv' || target === 'all') {
    console.log('\n=== Latvia sync ===');
    const lv = await svc.syncLatvia();
    console.log(`LV done — indexed: ${lv.indexed}, skipped: ${lv.skipped}`);
  }

  if (target === 'lt' || target === 'all') {
    console.log('\n=== Lithuania sync ===');
    const lt = await svc.syncLithuania();
    console.log(`LT done — indexed: ${lt.indexed}, skipped: ${lt.skipped}`);
  }

  await app.close();
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
