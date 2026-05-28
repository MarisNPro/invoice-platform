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
import { Logger, Module } from '@nestjs/common';
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
  const app    = await NestFactory.createApplicationContext(SyncModule, { logger: ['log', 'warn', 'error'] });
  const svc    = app.get(CompanySyncService);
  const logger = new Logger('SyncRunner');

  if (target === 'lv' || target === 'all') {
    logger.log('=== Latvia sync ===');
    const lv = await svc.syncLatvia();
    logger.log(`LV done — indexed: ${lv.indexed}, skipped: ${lv.skipped}`);
  }

  if (target === 'lt' || target === 'all') {
    logger.log('=== Lithuania sync ===');
    const lt = await svc.syncLithuania();
    logger.log(`LT done — indexed: ${lt.indexed}, skipped: ${lt.skipped}`);
  }

  await app.close();
  process.exit(0);
}

bootstrap().catch((err: unknown) => {
  const logger = new Logger('SyncRunner');
  logger.fatal(`Sync failed: ${String(err)}`);
  process.exit(1);
});
