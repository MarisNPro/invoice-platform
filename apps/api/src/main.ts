import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// @fastify/helmet's intersection type (PluginAsync & {contentSecurityPolicy}) uses a
// different declaration of FastifyPluginAsync than @nestjs/platform-fastify expects.
// Cast to any — the runtime value is the correct Fastify plugin.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fastifyHelmet    = require('@fastify/helmet')    as { default: unknown };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fastifyMultipart = require('@fastify/multipart') as { default: unknown };
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: process.env.NODE_ENV !== 'production',
      trustProxy: true,
    }),
  );

  // ── Multipart file uploads (required for /imports/upload) ────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyMultipart.default as any, {
    limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB max
  });

  // ── Security headers (OWASP baseline) ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyHelmet.default as any, {
    // Strict CSP for API — no script/style execution expected from API responses
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'none'"],
        frameAncestors: ["'none'"],
        sandbox:        [],
      },
    },
    // Prevent browsers from MIME-sniffing
    noSniff: true,
    // Deny framing entirely
    frameguard: { action: 'deny' },
    // HSTS: 1 year, include subdomains
    hsts: {
      maxAge:            31_536_000,
      includeSubDomains: true,
      preload:           true,
    },
    // Hide technology stack
    hidePoweredBy: true,
    // Cross-origin resource policy
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  const config = app.get(ConfigService);
  // Railway/Coolify inject PORT as a string — coerce explicitly. Falls back to
  // ConfigService/4000 for local dev.
  const port = Number(process.env.PORT) || config.get<number>('PORT', 4000);
  const prefix = config.get<string>('API_GLOBAL_PREFIX', 'api/v1');
  const corsOrigins = config.get<string>('CORS_ORIGINS', 'http://localhost:3000').split(',');

  app.setGlobalPrefix(prefix);

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-dev-tenant-id'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Bind the HTTP server FIRST, independent of Redis/BullMQ. Redis connects
  // lazily in the background (see RedisModule / MailQueueService); a Redis
  // outage must degrade features, never prevent the server from binding.
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 API listening on http://0.0.0.0:${port}/${prefix}`);
  logger.log(`📋 Health: http://0.0.0.0:${port}/${prefix}/health`);
  logger.log(`🛡️  Helmet security headers: enabled`);
}

// Safety net: a background Redis/ioredis rejection (e.g. Upstash ECONNRESET)
// must never crash an already-listening server. Log and keep serving.
process.on('unhandledRejection', (reason) => {
  new Logger('Process').error(`Unhandled promise rejection: ${String(reason)}`);
});

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.fatal(`Fatal error during startup: ${String(err)}`);
  process.exit(1);
});
