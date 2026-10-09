/** Loopback-only live viewer. Polling snapshots never settles an open LLM or tool span. */
import { createServer } from 'node:http';
import { renderDashboard } from './visualization.js';

/** Validate deployment options before opening sockets. Port zero is useful for isolated tests. */
export function resolveLiveConfig(config = {}) {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) throw new Error('live must be an object');
  const resolved = { enabled: config.enabled ?? false, port: config.port ?? 8767,
    pollIntervalMs: config.pollIntervalMs ?? 1000, maxRetainedReports: config.maxRetainedReports ?? 100,
    catalogRefreshMs: config.catalogRefreshMs ?? 30000, theme: config.theme ?? 'system' };
  if (typeof resolved.enabled !== 'boolean') throw new Error('live.enabled must be boolean');
  if (!Number.isInteger(resolved.port) || resolved.port < 0 || resolved.port > 65535) throw new Error('live.port must be an integer from 0 to 65535');
  if (!Number.isInteger(resolved.pollIntervalMs) || resolved.pollIntervalMs < 250 || resolved.pollIntervalMs > 60000) throw new Error('live.pollIntervalMs must be 250..60000');
  if (!Number.isInteger(resolved.maxRetainedReports) || resolved.maxRetainedReports < 1 || resolved.maxRetainedReports > 10000) throw new Error('live.maxRetainedReports must be 1..10000');
  if (!Number.isInteger(resolved.catalogRefreshMs) || resolved.catalogRefreshMs < 1000 || resolved.catalogRefreshMs > 3600000) throw new Error('live.catalogRefreshMs must be 1000..3600000');
  if (!['system', 'light', 'dark'].includes(resolved.theme)) throw new Error('live.theme must be system, light or dark');
  return resolved;
}

/** Bounded completed-report retention; live turns stay owned by their analyzers. */
export class LiveReports {
  constructor(limit) { this.limit = limit; this.reports = []; }
  add(report) { this.reports.push(report); if (this.reports.length > this.limit) this.reports.shift(); }
  forSession(sessionId) { return this.reports.filter(report => report.sessionId === sessionId); }
  sessionIds() { return this.reports.map(report => report.sessionId); }
}

/** Start a local viewer backed by live session ids and a selected-session snapshot function. */
export async function startLiveServer(config, source) {
  const dashboard = await renderDashboard([], { pollIntervalMs: config.pollIntervalMs, theme: config.theme });
  const server = createServer((request, response) => {
    void (async () => {
      const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const address = server.address();
      const origins = new Set([`http://127.0.0.1:${address.port}`, `http://localhost:${address.port}`]);
      const url = new URL(request.url, 'http://localhost');
      const publicViewer = url.pathname === '/' || url.pathname === '/dashboard.html';
      // Reject cross-site and rebinding requests; no CORS permission is emitted.
      if (!origins.has(`http://${request.headers.host}`) || (!publicViewer && ((request.headers.origin && !origins.has(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site'))) {
        json(403, { error: 'Only same-origin loopback access is allowed' }); return;
      }
      if (request.method !== 'GET') { json(405, { error: 'GET only' }); return; }
      if (url.pathname === '/' || url.pathname === '/dashboard.html') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(dashboard);
      } else if (url.pathname === '/api/sessions') {
        json(200, { sessions: await source.list() });
      } else if (url.pathname === '/api/live' || url.pathname === '/api/history') {
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId || !(await source.list()).some(session => session.id === sessionId)) { json(404, { error: 'Session is unavailable' }); return; }
        if (url.pathname === '/api/history') {
          if (!source.history) { json(404, { error: 'History export unavailable' }); return; }
          response.setHeader('Content-Disposition', 'attachment; filename="session-history.json"');
          json(200, await source.history(sessionId));
        } else json(200, { sessionId, reports: await source.snapshot(sessionId), sampledAt: Date.now() });
      } else json(404, { error: 'Not found' });
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Live snapshot failed' }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/dashboard.html`,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
