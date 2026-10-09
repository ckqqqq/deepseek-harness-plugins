import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTask } from '../src/task-analysis.js';

test('explicitly selected turns aggregate measured time without inventing legacy timings', () => {
  const timing = { durationMs: 100, llmOnlyMs: 40, toolOnlyMs: 30, overlapMs: 10, otherMs: 20,
    llmCumulativeMs: 50, llmAttemptCount: 2, failedAttemptCount: 1,
    spans: [{ kind: 'tool', name: 'shell', durationMs: 20 }, { kind: 'tool', name: 'shell', durationMs: 40 }],
    toolsByName: [{ name: 'shell', count: 2, totalMs: 60, maxMs: 40, errors: 1, incomplete: 0 }] };
  const report = analyzeTask([{ sessionId: 'one', runtimeTiming: timing }, { sessionId: 'two', runtimeTiming: timing }, { sessionId: 'one' }]);
  assert.equal(report.activeTime.durationMs, 200);
  assert.equal(report.activeTime.llmOnlyMs, 80);
  assert.equal(report.measuredTurnCount, 2);
  assert.equal(report.missingTimingCount, 1);
  assert.equal(report.toolsByName[0].meanMs, 30);
  assert.equal(report.toolsByName[0].errors, 2);
  assert.deepEqual(report.sessionIds, ['one','two']);
  assert.match(report.notes[0], /not task wall time/);
});
