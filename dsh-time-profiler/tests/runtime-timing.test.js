import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeTiming, partitionTime } from '../src/runtime-timing.js';
import { apply } from '../src/index.js';

test('overlapping LLM, parallel and nested tools partition wall time exactly', () => {
  assert.deepEqual(partitionTime(100, [
    { kind: 'llm', startMs: 0, durationMs: 40 },
    { kind: 'tool', startMs: 20, durationMs: 60 },
    { kind: 'tool', startMs: 30, durationMs: 20 },
    { kind: 'tool', startMs: 70, durationMs: 20 },
  ]), { llmOnlyMs: 20, toolOnlyMs: 50, overlapMs: 20, otherMs: 10 });
});

test('live attempts measure first output, failures and nested tool execution', () => {
  let now = 0;
  const runtime = new RuntimeTiming(() => now);
  runtime.start('session');
  now = 5;
  runtime.stream('session', { type: 'start', step: 1, attemptId: 'attempt' });
  now = 10;
  runtime.stream('session', { type: 'chunk', attemptId: 'attempt', chunk: { type: 'usage' } });
  now = 15;
  runtime.stream('session', { type: 'chunk', attemptId: 'attempt', chunk: { type: 'text-delta', text: 'hello' } });
  now = 25;
  runtime.stream('session', { type: 'end', attemptId: 'attempt', outcome: { kind: 'committed', eventType: 'assistant/attempt' } });
  const outer = runtime.begin('session', { kind: 'tool', name: 'run_code' });
  now = 30;
  const inner = runtime.begin('session', { kind: 'tool', name: 'shell', nested: true });
  now = 50;
  runtime.end(inner, 'error');
  now = 60;
  runtime.end(outer, 'success');
  now = 100;
  const report = runtime.finish('session');
  assert.equal(report.spans[0].firstOutputMs, 10);
  assert.equal(report.llmCumulativeMs, 20);
  assert.equal(report.failedAttemptCount, 1);
  assert.equal(report.toolOnlyMs, 35);
  assert.equal(report.toolsByName.find(tool => tool.name === 'shell').errors, 1);
  assert.equal(report.otherMs, 45);
  assert.equal(runtime.turns.size, 0);
});

test('unfinished execution is clipped and late settlement cannot contaminate another turn', () => {
  let now = 0;
  const runtime = new RuntimeTiming(() => now);
  runtime.start('session');
  now = 10;
  const handle = runtime.begin('session', { kind: 'tool', name: 'shell' });
  now = 20;
  const report = runtime.finish('session');
  assert.equal(report.spans[0].durationMs, 10);
  assert.equal(report.spans[0].outcome, 'open-at-turn-end');
  runtime.start('session');
  now = 30;
  runtime.end(handle, 'success');
  assert.equal(runtime.finish('session').spans.length, 0);
  assert.equal(runtime.begin('not-observed', { kind: 'tool' }), undefined);
});

test('tool middleware delegates exactly once and preserves values and thrown errors', async () => {
  const handlers = new Map();
  let dispose;
  await apply({ on(name, handler) { handlers.set(name, handler); }, effect(factory) { dispose = factory(); },
    logger: { info() {}, warn() {} } });
  let count = 0;
  const result = { isError: false, value: 42 };
  assert.equal(await handlers.get('tools/execute')({ name: 'shell' }, async () => { count++; return result; }), result);
  assert.equal(count, 1);
  const failure = new Error('original failure');
  await assert.rejects(handlers.get('tools/execute')({ name: 'shell' }, async () => { throw failure; }), error => error === failure);
  await dispose();
});

test('sample percentiles expose long tails and empty samples remain unknown', async () => {
  const { durationStatistics } = await import('../src/runtime-timing.js');
  assert.deepEqual(durationStatistics([]), { count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null });
  const statistics = durationStatistics([1, 2, 3, 100]);
  assert.equal(statistics.p50Ms, 2);
  assert.equal(statistics.p95Ms, 100);
  assert.equal(statistics.meanMs, 26.5);
});
