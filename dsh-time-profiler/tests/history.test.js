import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionHistory } from '../src/history.js';

test('replay selected history, refresh advancing cuts and dispose every lease', async () => {
  const events = [
    { type: 'turn/start', time: 100, data: { turn: 1 } },
    { type: 'step/start', time: 110, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', time: 140, data: { turn: 1, step: 1, message: { content: 'private' } } },
    { type: 'turn/end', time: 160, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  let released = 0;
  const history = new SessionHistory({ async observeSession(id) {
    assert.equal(id, 'selected');
    return { header: { id }, cursor: events.length - 1, events: [...events], [Symbol.dispose]() { released++; } };
  } }, 10);
  const reports = await history.read('selected');
  assert.equal(reports[0].durationMs, 60);
  assert.equal(reports[0].measurementSource, 'history');
  assert.equal(reports[0].runtimeTiming, undefined);
  assert.equal(JSON.stringify(reports).includes('private'), false);
  assert.equal((await history.read('selected')).length, 1);
  events.push({ type: 'turn/start', time: Date.now() - 20, data: { turn: 2 } });
  assert.equal((await history.read('selected'))[1].live, true);
  const exported = await history.read('selected', true);
  assert.equal(exported.events.length, 5);
  assert.equal(exported.header.id, 'selected');
  assert.equal(released, 4);
});

test('failed history replay releases its observation', async () => {
  let released = false;
  const history = new SessionHistory({ async observeSession() {
    return { cursor: 1, events: [{ type: 'turn/start', time: 1, data: null }], [Symbol.dispose]() { released = true; } };
  } }, 5);
  await assert.rejects(history.read('bad'));
  assert.equal(released, true);
});
