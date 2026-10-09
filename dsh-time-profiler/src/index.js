/** Cordis host plugin: observe live session events and save one local report per turn. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TimingAnalyzer } from './analyzer.js';
import { renderDashboard } from './visualization.js';
import { RuntimeTiming } from './runtime-timing.js';
import { LiveReports, resolveLiveConfig, startLiveServer } from './live-server.js';
import { SessionHistory } from './history.js';
import { SessionCatalog } from './catalog.js';

export const name = 'dsh-time-profiler';
export const inject = ['sessions', 'sessionQuery'];

/** Mount the observer. Relative output paths resolve against the host process cwd. */
export async function apply(ctx, config = {}) {
  const outputDirectory = config.outputDirectory ?? './dsh-performance';
  if (typeof outputDirectory !== 'string' || outputDirectory.trim() === '') {
    throw new Error('dsh-time-profiler: outputDirectory must be a nonempty string');
  }
  const directory = resolve(outputDirectory);
  const liveConfig = resolveLiveConfig(config.live);
  const analyzer = new TimingAnalyzer();
  const runtime = new RuntimeTiming();
  const pendingWrites = new Set();
  const retained = new LiveReports(liveConfig.maxRetainedReports);
  let liveServer;
  ctx.on('agent/assistant-stream', ({ agent, frame }) => runtime.stream(agent.id, frame));
  ctx.on('tools/execute', async (execution, next) => {
    const handle = runtime.begin(execution.agent?.id, {
      kind: 'tool', name: execution.name, callId: execution.callId,
      rootCallId: execution.rootCallId, nested: execution.parent !== undefined,
    });
    let outcome = 'error';
    try {
      const result = await next();
      outcome = result.isError ? 'error' : 'success';
      return result;
    } finally {
      runtime.end(handle, outcome);
    }
  });
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') runtime.start(session.id);
    const timing = event.type === 'turn/end' ? runtime.finish(session.id) : undefined;
    const report = analyzer.consume(session.id, event);
    if (!report) return;
    report.runtimeTiming = timing;
    if (liveConfig.enabled) retained.add(report);
    // Never put session ids in filenames: a restored id may contain path separators.
    const filename = join(directory, `turn-${report.turn}-${randomUUID()}.json`);
    const task = (async () => {
      // Let the current event/turn complete before serialization and dashboard construction.
      await new Promise(resolve => setImmediate(resolve));
      const contents = JSON.stringify(report, null, 2) + '\n';
      await mkdir(directory, { recursive: true });
      await writeFile(filename, contents, { flag: 'wx', mode: 0o600 });
      const dashboardFilename = filename.replace(/\.json$/, '.html');
      await writeFile(dashboardFilename, await renderDashboard([report]), { flag: 'wx', mode: 0o600 });
      ctx.logger.info(`dsh-time-profiler: turn ${report.turn}, ${report.durationMs}ms → ${dashboardFilename}`);
    })().catch(error => {
      ctx.logger.warn(`dsh-time-profiler: report write failed: ${String(error)}`);
    });
    pendingWrites.add(task);
    void task.finally(() => pendingWrites.delete(task));
  });
  ctx.on('session/disposed', session => {
    analyzer.forget(session.id);
    runtime.forget(session.id);
  });
  ctx.effect(() => async () => {
    if (liveServer) await liveServer.close();
    await Promise.all(pendingWrites);
    analyzer.sessions.clear();
    runtime.turns.clear();
    retained.reports.length = 0;
  });
  if (liveConfig.enabled) {
    const query = ctx.get('sessionQuery');
    if (!query) throw new Error('dsh-time-profiler: live history requires sessionQuery');
    const history = new SessionHistory(query, liveConfig.maxRetainedReports);
    const catalog = new SessionCatalog(query, liveConfig.catalogRefreshMs);
    liveServer = await startLiveServer(liveConfig, {
      list: async () => {
        const loaded = new Set(ctx.sessions.list().map(session => session.id));
        const records = await catalog.list();
        const metadata = new Map(records.map(record => [record.id, record]));
        return [...new Set([...loaded, ...metadata.keys(), ...retained.sessionIds()])].map(id => ({
          ...metadata.get(id),
          id, loaded: loaded.has(id), running: runtime.turns.has(id),
          capturedTurns: retained.forSession(id).length,
        }));
      },
      history: sessionId => history.read(sessionId, true),
      snapshot: async sessionId => {
        const historical = await history.read(sessionId);
        const measured = retained.forSession(sessionId);
        const completed = historical.filter(report => !report.live).map(report =>
          measured.find(candidate => candidate.turn === report.turn && candidate.startedAt === report.startedAt) ?? report);
        const active = analyzer.snapshot(sessionId);
        if (!active) return [...completed, ...historical.filter(report => report.live)];
        active.runtimeTiming = runtime.snapshot(sessionId);
        if (!active.runtimeTiming) active.measurementSource = 'history';
        return [...completed, active];
      },
    });
    ctx.logger.info(`dsh-time-profiler: live viewer → ${liveServer.url}`);
  }
}
