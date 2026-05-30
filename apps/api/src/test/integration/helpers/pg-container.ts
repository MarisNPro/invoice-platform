/**
 * PostgreSQL Testcontainer lifecycle helper.
 *
 * Prisma v5 evaluates the `DATABASE_URL` env-var lazily — at `$connect()` time,
 * not at construction time.  We therefore set `process.env.DATABASE_URL` to the
 * container URL and keep it set for the lifetime of the test worker process.
 * This is safe because Jest integration tests run in an isolated worker
 * (maxWorkers: 1, separate from the main Jest process).
 *
 * Usage in a Jest suite:
 *
 *   let helper: PgContainerHelper;
 *
 *   beforeAll(async () => {
 *     helper = await PgContainerHelper.start();
 *   }, 120_000);
 *
 *   afterAll(() => helper.stop());
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaService } from '../../../prisma/prisma.service';

export class PgContainerHelper {
  private constructor(
    private readonly container: StartedPostgreSqlContainer,
    public readonly prisma: PrismaService,
    public readonly connectionUri: string,
  ) {}

  /** Start a fresh PostgreSQL container, run all Prisma migrations, return helper. */
  static async start(): Promise<PgContainerHelper> {
    // ── 1. Start the container ────────────────────────────────────────────────
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('invoice_test')
      .withUsername('invoice')
      .withPassword('invoice')
      .withStartupTimeout(90_000)
      .start();

    const url = container.getConnectionUri();

    // ── 2. Run all Prisma migrations against the container ────────────────────
    //    This includes schema creation AND the next_invoice_number() PG function.
    const apiRoot = path.resolve(__dirname, '../../../../');
    execSync(
      'npx prisma migrate deploy --schema=./prisma/schema.prisma',
      {
        cwd: apiRoot,
        // schema.prisma declares directUrl = env("DIRECT_URL"); migrate deploy
        // needs it too. Point both at the container (CI sets both; local may not).
        env:   { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
        stdio: 'pipe',
      },
    );

    // ── 3. Point process.env at the container URL *before* PrismaService init ─
    //    Prisma v5 reads DATABASE_URL at $connect() time (lazy validation).
    //    We set it now and leave it set for the lifetime of the test worker.
    process.env['DATABASE_URL'] = url;

    const prisma = new PrismaService();
    await prisma.$connect();

    return new PgContainerHelper(container, prisma, url);
  }

  /** Disconnect Prisma and stop the container. */
  async stop(): Promise<void> {
    await this.prisma.$disconnect();
    await this.container.stop({ timeout: 10_000 });
  }

  /**
   * Wipe all user data but keep the schema and migrations table.
   * Called in beforeEach to give every test case a clean slate.
   */
  async truncateAll(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename NOT IN ('_prisma_migrations')
        LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  }
}
