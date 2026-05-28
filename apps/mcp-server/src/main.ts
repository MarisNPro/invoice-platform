/**
 * MCP server entry point.
 *
 * HTTP endpoints:
 *   GET  /sse       — open a new SSE connection (auth via Authorization header)
 *   POST /messages  — send a JSON-RPC message to an existing session (?sessionId=…)
 *   GET  /health    — liveness probe
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { validateApiKey } from './auth.js';
import { createMcpServer } from './server.js';

const PORT = Number(process.env.MCP_PORT ?? 4020);

// Map from sessionId → SSEServerTransport (for routing POST /messages)
const sessions = new Map<string, SSEServerTransport>();

const app = express();
app.use(express.json());

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:   'ok',
    sessions: sessions.size,
    uptime:   Math.floor(process.uptime()),
  });
});

// ── SSE endpoint ───────────────────────────────────────────────────────────────
app.get('/sse', async (req: Request, res: Response) => {
  // Auth
  const authResult = validateApiKey(req.headers.authorization);
  if (!authResult) {
    res.status(401).json({ error: 'Unauthorized — provide a valid API key in the Authorization header' });
    return;
  }

  const { orgId, isReadOnly } = authResult;

  // Create per-connection MCP server and transport
  const mcpServer = createMcpServer(orgId, isReadOnly);
  const transport = new SSEServerTransport('/messages', res);

  // Track session
  const sessionId = transport.sessionId;
  sessions.set(sessionId, transport);
  console.log(`[sse] New connection — session=${sessionId} org=${orgId} ro=${isReadOnly}`);

  // Clean up when connection closes
  res.on('close', () => {
    sessions.delete(sessionId);
    console.log(`[sse] Connection closed — session=${sessionId}`);
  });

  // Connect server ↔ transport
  await mcpServer.connect(transport);
});

// ── POST /messages — route JSON-RPC to the right session ──────────────────────
app.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query['sessionId'] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: 'Missing ?sessionId query parameter' });
    return;
  }

  const transport = sessions.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: `Session "${sessionId}" not found or expired` });
    return;
  }

  try {
    // Pass pre-parsed body — Express json() middleware already consumed the stream
    await transport.handlePostMessage(req, res, req.body);
  } catch (err) {
    console.error('[messages] Error handling message:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🔌 MCP server listening on http://localhost:${PORT}`);
  console.log(`   SSE endpoint : GET  http://localhost:${PORT}/sse`);
  console.log(`   Messages     : POST http://localhost:${PORT}/messages?sessionId=<id>`);
  console.log(`   Health       : GET  http://localhost:${PORT}/health`);
  console.log(
    `\n   Auth         : ${process.env.MCP_DEV_KEY ? `dev key configured (org: ${process.env.MCP_DEV_ORG_ID})` : 'no dev key — set MCP_DEV_KEY'}`,
  );
});
