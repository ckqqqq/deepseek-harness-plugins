import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { startLiveServer, resolveLiveConfig, LiveReports } from '../src/live-server.js';
import { RuntimeTiming } from '../src/runtime-timing.js';
import { TimingAnalyzer } from '../src/analyzer.js';
import { renderDashboard } from '../src/visualization.js';
import { get } from 'node:http';

const fixture = sessionId => ({ schemaVersion: 1, sessionId, turn: 1, startedAt: 1000, endedAt: 1100, durationMs: 100,
  endReason: 'running', live: true, steps: [], tools: [], unfinishedToolCount: 0 });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('snapshots extend an open call without ending it or changing its eventual duration', () => {
  let now = 0;
  const runtime = new RuntimeTiming(() => now);
  runtime.start('first');
  now = 10;
  const handle = runtime.begin('first', { kind: 'tool', name: 'shell' });
  now = 30;
  assert.equal(runtime.snapshot('first').spans[0].durationMs, 20);
  assert.equal(runtime.snapshot('first').spans[0].outcome, 'running');
  assert.equal(handle.ended, false);
  now = 50;
  assert.equal(runtime.snapshot('first').toolOnlyMs, 40);
  runtime.end(handle, 'success');
  now = 60;
  assert.equal(runtime.finish('first').spans[0].durationMs, 40);
  const analyzer = new TimingAnalyzer();
  analyzer.consume('first', { type: 'turn/start', time: 1000, data: { turn: 1 } });
  assert.equal(analyzer.snapshot('first', 1100).live, true);
  assert.equal(analyzer.sessions.size, 1);
  assert.equal(analyzer.consume('first', { type: 'turn/end', time: 1200, data: { turn: 1, reason: { kind: 'completed' } } }).durationMs, 200);
});

test('live routes select exactly one session, reject cross-site access and close cleanly', async () => {
  const server = await startLiveServer(resolveLiveConfig({ port: 0 }), {
    list: () => [{ id: 'first', running: true }, { id: 'second', running: false }],
    snapshot: id => [fixture(id)],
    history: async id => ({ header: { id }, events: [] }),
  });
  try {
    const root = new URL(server.url).origin;
    assert.equal((await (await fetch(root + '/api/sessions')).json()).sessions.length, 2);
    const response = await (await fetch(root + '/api/live?sessionId=second')).json();
    assert.equal(response.reports[0].sessionId, 'second');
    assert.equal((await (await fetch(root + '/api/history?sessionId=second')).json()).header.id, 'second');
    assert.equal((await fetch(server.url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200);
    assert.equal((await fetch(root + '/api/live?sessionId=missing')).status, 404);
    assert.equal((await fetch(root + '/api/sessions', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
    const rebindingStatus = await new Promise((resolve, reject) => {
      get(root + '/api/sessions', { headers: { Host: 'unrelated.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(rebindingStatus, 403);
    assert.equal((await fetch(root + '/api/sessions', { method: 'POST' })).status, 405);
    const html = await (await fetch(server.url)).text();
    assert.match(html, /指定对话/);
    assert.equal(html.includes('__DSH_LIVE__'), false);
  } finally { await server.close(); }
  await assert.rejects(fetch(server.url));
});

test('live configuration fails loudly and retention is bounded', () => {
  assert.throws(() => resolveLiveConfig({ pollIntervalMs: 1 }), /pollIntervalMs/);
  assert.throws(() => resolveLiveConfig({ port: -1 }), /port/);
  assert.throws(() => resolveLiveConfig({ maxRetainedReports: 0 }), /maxRetainedReports/);
  const reports = new LiveReports(2);
  reports.add(fixture('first')); reports.add(fixture('second')); reports.add(fixture('third'));
  assert.equal(reports.forSession('first').length, 0);
  assert.deepEqual(reports.sessionIds(), ['second', 'third']);
});

test('session switch discards an in-flight old response and pause freezes sampling', async () => {
  let scheduledPoll, resolveFirst;
  let snapshotRequests = 0;
  const dom = new JSDOM(await renderDashboard([], { pollIntervalMs: 1000 }), {
    runScripts: 'dangerously', url: 'http://127.0.0.1:8767/dashboard.html?sessionId=first',
    beforeParse(window) {
      window.AbortController = AbortController;
      const nativeTimer = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay) => delay === 5000 ? nativeTimer(callback, delay) : (scheduledPoll = callback, 0);
      window.fetch = async path => {
        if (path === '/api/sessions') return { ok: true, json: async () => ({ sessions: [{ id: 'first', running: true, loaded: true, capturedTurns: 0 }, { id: 'second', running: true, loaded: true, capturedTurns: 0 }] }) };
        snapshotRequests++;
        const sessionId = new URL(path, window.location.origin).searchParams.get('sessionId');
        if (sessionId === 'first') await new Promise(resolve => { resolveFirst = resolve; });
        return { ok: true, json: async () => ({ sessionId, sampledAt: 2000, reports: [fixture(sessionId)] }) };
      };
    },
  });
  try {
    await tick();
    const select = dom.window.document.getElementById('live-session');
    select.value = 'second'; select.dispatchEvent(new dom.window.Event('change'));
    resolveFirst(); await tick();
    assert.equal(dom.window.document.getElementById('selection').textContent.includes('first'), false);
    await scheduledPoll();
    assert.match(dom.window.document.getElementById('selection').textContent, /second/);
    assert.match(dom.window.document.getElementById('live-status').textContent, /实时分析中/);
    const requestsBeforePause = snapshotRequests;
    dom.window.document.getElementById('live-pause').click();
    await scheduledPoll();
    assert.equal(snapshotRequests, requestsBeforePause);
  } finally { dom.window.close(); }
});
