/** Keyless integration against the adjacent, built harness and its real scoped event dispatcher. */
import { Context } from '../../../deepseek-harness/vendor/cordis/lib/index.js';
import { SessionStore, SessionId } from '../../../deepseek-harness/packages/core/session/lib/index.js';
import { agentEvents } from '../../../deepseek-harness/packages/core/agent/lib/index.js';
import { scopeTarget } from '../../../deepseek-harness/packages/core/scope/lib/index.js';
import { SessionQueryEngine } from '../../../deepseek-harness/packages/session-query/session-query/lib/index.js';
import * as profiler from '../src/index.js';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'dsh-timing-smoke-'));
const context = new Context();
try {
  await context.plugin(SessionStore);
  await context.plugin(SessionQueryEngine);
  const fiber = await context.plugin(profiler, { outputDirectory: directory });
  const session = context.sessions.create(SessionId('runtime-smoke'), { meta: {} });
  const agent = { id: session.id, session };
  const dispatch = agentEvents(context, agent);
  session.append('turn/start', { turn: 1 });
  session.append('step/start', { turn: 1, step: 1 });
  dispatch.emit('agent/assistant-stream', { frame: { type: 'start', step: 1, turn: 1, attemptId: 'smoke-attempt', revision: 1 } });
  dispatch.emit('agent/assistant-stream', { frame: { type: 'chunk', attemptId: 'smoke-attempt', revision: 2, index: 0, time: Date.now(), chunk: { type: 'text-delta', index: 0, text: 'output' } } });
  dispatch.emit('agent/assistant-stream', { frame: { type: 'end', attemptId: 'smoke-attempt', revision: 3, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 2 } } });
  const value = { isError: false, value: 'unchanged' };
  const result = await context.waterfall(scopeTarget({}, agent), 'tools/execute',
    { agent, name: 'smoke-tool', callId: 'call-one', rootCallId: 'call-one', signal: new AbortController().signal }, async () => value);
  assert.equal(result, value);
  session.append('step/end', { turn: 1, step: 1 });
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await fiber.dispose();
  const files = await readdir(directory);
  assert.equal(files.length, 2);
  const report = JSON.parse(await readFile(join(directory, files.find(file => file.endsWith('.json'))), 'utf8'));
  assert.equal(report.runtimeTiming.llmAttemptCount, 1);
  assert.equal(report.runtimeTiming.toolsByName[0].name, 'smoke-tool');
  const timing = report.runtimeTiming;
  assert.ok(Math.abs(timing.llmOnlyMs + timing.toolOnlyMs + timing.overlapMs + timing.otherMs - timing.durationMs) < 0.000001);
  console.log('Real scoped Cordis + SessionStore smoke passed: LLM attempt, tool delegation, partition, JSON + HTML.');
} finally {
  await context.fiber.dispose();
  await rm(directory, { recursive: true, force: true });
}
