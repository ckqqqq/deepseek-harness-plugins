import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimingAnalyzer } from '../src/analyzer.js';
import { apply } from '../src/index.js';

function event(type, time, data = {}) { return { type, time, data: { turn: 1, ...data } }; }

test('parallel tools overlap, retries count, and summaries preserve failures', () => {
  const analyzer = new TimingAnalyzer();
  const consume = value => analyzer.consume('session-one', value);
  consume(event('turn/start', 100));
  consume(event('step/start', 110, { step: 1 }));
  consume(event('assistant/attempt', 150, { step: 1 }));
  consume(event('assistant/message', 200, { step: 1 }));
  consume(event('tool/call', 200, { step: 1, callId: 'first', name: 'shell', arguments: 'secret' }));
  consume(event('tool/call', 210, { step: 1, callId: 'second', name: 'shell' }));
  consume(event('tool/result', 300, { message: { toolCallId: 'first', isError: false } }));
  consume(event('tool/result', 310, { message: { toolCallId: 'second', isError: true } }));
  consume(event('step/end', 320, { step: 1 }));
  const report = consume(event('turn/end', 330, { reason: { kind: 'error' } }));
  assert.equal(report.durationMs, 230);
  assert.equal(report.steps[0].stepToAssistantMs, 90);
  assert.equal(report.steps[0].attempts, 2);
  assert.deepEqual(report.toolsByName[0], { name: 'shell', count: 2, totalMs: 200, maxMs: 100, errors: 1, meanMs: 100 });
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.equal(analyzer.sessions.size, 0);
});

test('sessions are isolated; missing starts and unknown results do not invent timings', () => {
  const analyzer = new TimingAnalyzer();
  assert.equal(analyzer.consume('late', event('turn/end', 100, { reason: { kind: 'cancelled' } })), undefined);
  analyzer.consume('first', event('turn/start', 10));
  analyzer.consume('second', event('turn/start', 20));
  analyzer.consume('first', event('tool/call', 30, { callId: 'same', name: 'fs' }));
  analyzer.consume('second', event('tool/result', 40, { message: { toolCallId: 'same' } }));
  const report = analyzer.consume('first', event('turn/end', 50, { reason: { kind: 'cancelled' } }));
  assert.equal(report.unfinishedToolCount, 1);
  assert.equal(report.tools.length, 0);
  analyzer.forget('second');
  assert.equal(analyzer.sessions.size, 0);
});

test('backward clocks are flagged rather than hidden', () => {
  const analyzer = new TimingAnalyzer();
  analyzer.consume('clock', event('turn/start', 100));
  const report = analyzer.consume('clock', event('turn/end', 90, { reason: { kind: 'error' } }));
  assert.equal(report.clockAnomaly, true);
  assert.equal(report.durationMs, -10);
});

test('plugin writes a valid report and drains writes on disposal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-profiler-'));
  const listeners = new Map();
  let dispose;
  const warnings = [];
  const context = {
    on(name, listener) { listeners.set(name, listener); },
    effect(factory) { dispose = factory(); },
    logger: { info() {}, warn(message) { warnings.push(message); } },
  };
  try {
    await apply(context, { outputDirectory: directory });
    const session = { id: '../../untrusted-session-id' };
    listeners.get('session/event')(session, event('turn/start', 10));
    listeners.get('session/event')(session, event('turn/end', 70, { reason: { kind: 'completed' } }));
    await dispose();
    const filenames = await readdir(directory);
    assert.equal(filenames.length, 2);
    const report = JSON.parse(await readFile(join(directory, filenames.find(filename => filename.endsWith('.json'))), 'utf8'));
    const dashboard = await readFile(join(directory, filenames.find(filename => filename.endsWith('.html'))), 'utf8');
    assert.match(dashboard, /profiler-smoke|untrusted-session-id/);
    assert.equal(dashboard.includes('__DSH_REPORTS__'), false);
    assert.equal(report.durationMs, 60);
    assert.equal(report.sessionId, session.id);
    assert.equal(warnings.length, 0);
    await assert.rejects(apply(context, { outputDirectory: '' }), /nonempty/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('filesystem failures are contained and reported', async () => {
  const listeners = new Map();
  let dispose;
  const warnings = [];
  await apply({ on(name, handler) { listeners.set(name, handler); }, effect(factory) { dispose = factory(); },
    logger: { info() {}, warn(message) { warnings.push(message); } } }, { outputDirectory: '/dev/null/reports' });
  listeners.get('session/event')({ id: 'failed' }, event('turn/start', 0));
  listeners.get('session/event')({ id: 'failed' }, event('turn/end', 1, { reason: { kind: 'completed' } }));
  await dispose();
  assert.match(warnings[0], /report write failed/);
});
