// Opt-in streamable-HTTP mode, so one long-lived process can serve every
// assistant session instead of one stdio process each. Loopback only.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const HOST = '127.0.0.1';
const MAX_BODY = 16 * 1024 * 1024;
const IDLE_MS = 24 * 60 * 60 * 1000;

// `--http 18705`, `--http=18705`, or MARGIN_MCP_HTTP_PORT. null means stdio.
export function httpPort(argv, env) {
  let value = env.MARGIN_MCP_HTTP_PORT || null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--http') value = argv[i + 1] ?? '';
    else if (argv[i].startsWith('--http=')) value = argv[i].slice('--http='.length);
  }
  if (value === null) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid HTTP port: ${JSON.stringify(value)}`);
  return port;
}

const jsonRpcError = (res, status, message) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};

async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Parse error: invalid JSON.'), { status: 400 }); }
}

export async function serveHttp(port, createServer, log = message => process.stderr.write(`${message}\n`)) {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const sessions = new Map(); // mcp-session-id -> { transport, server, seen }

  const close = async id => {
    const session = sessions.get(id); if (!session) return;
    sessions.delete(id);
    await session.server.close().catch(() => {});
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    if (url.pathname !== '/mcp') return jsonRpcError(res, 404, 'Not found. The MCP endpoint is /mcp.');
    // Checked here as well as in the transport, so a rebinding page never gets a session made for it.
    if (!allowedHosts.includes(req.headers.host)) return jsonRpcError(res, 403, `Invalid Host header: ${req.headers.host}`);
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return jsonRpcError(res, 403, `Invalid Origin header: ${req.headers.origin}`);

    const id = req.headers['mcp-session-id'];
    if (id) {
      const session = sessions.get(id);
      if (!session) return jsonRpcError(res, 404, 'Session not found. Start a new session with initialize.');
      session.seen = Date.now();
      return session.transport.handleRequest(req, res);
    }
    if (req.method !== 'POST') return jsonRpcError(res, 400, 'No session. Send initialize first.');
    const body = await readJson(req);
    if (!(Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body))) {
      return jsonRpcError(res, 400, 'No session. Send initialize first.');
    }
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableDnsRebindingProtection: true, allowedHosts, allowedOrigins,
      onsessioninitialized: sid => { sessions.set(sid, { transport, server, seen: Date.now() }); },
      onsessionclosed: sid => close(sid)
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    if (!transport.sessionId) await server.close().catch(() => {}); // initialize was rejected
  };

  const httpServer = http.createServer((req, res) => {
    handler(req, res).catch(e => {
      if (!res.headersSent) jsonRpcError(res, e.status ?? 500, e.status ? e.message : 'Internal server error.');
      if (!e.status) log(`margin-mcp: ${e.stack ?? e}`);
    });
  });

  // Clients that exit without DELETE leave sessions behind; drop long-idle ones.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - IDLE_MS;
    for (const [sid, session] of sessions) if (session.seen < cutoff) close(sid);
  }, 10 * 60 * 1000);
  sweep.unref();

  const shutdown = async () => {
    clearInterval(sweep);
    await Promise.all([...sessions.keys()].map(close));
    httpServer.close(() => process.exit(0));
    httpServer.closeAllConnections?.();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, HOST, () => { httpServer.off('error', reject); resolve(); });
  });
  log(`margin-mcp: listening on http://${HOST}:${port}/mcp`);
  return { httpServer, sessions };
}
