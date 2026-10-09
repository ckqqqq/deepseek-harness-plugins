import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderDashboard } from '../src/visualization.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const report = turn => ({ schemaVersion: 1, sessionId: 'first', turn,
  startedAt: turn * 1000, endedAt: turn * 1000 + 100, durationMs: 100,
  endReason: 'completed', steps: [], tools: [], unfinishedToolCount: 0 });

async function createViewer(search = '?sessionId=first') {
  let scheduledPoll;
  let turnCount = 2;
  const sessions = [
    { id: 'first', title: '修复计时', workspace: '/work/alpha', loaded: true },
    { id: 'second', title: '浏览器分析', workspace: '/work/beta', loaded: false },
  ];
  const dom = new JSDOM(await renderDashboard([], { pollIntervalMs: 1000 }), {
    runScripts: 'dangerously', url: 'http://localhost:8767/dashboard.html' + search,
    beforeParse(window) {
      window.AbortController = AbortController;
      window.setTimeout = (callback, delay) => { if (delay !== 5000) scheduledPoll = callback; return 0; };
      window.fetch = async path => ({ ok: true, json: async () => path === '/api/sessions'
        ? { sessions } : { sampledAt: Date.now(), reports: Array.from({ length: turnCount }, (_, index) => report(index + 1)) } });
    },
  });
  await settle();
  return { dom, poll: () => scheduledPoll(), addTurn: () => { turnCount++; } };
}

test('historical turn selection survives new reports and following latest can resume', async () => {
  const viewer = await createViewer();
  try {
    const document = viewer.dom.window.document;
    const selection = document.getElementById('report-select');
    selection.value = '0'; selection.dispatchEvent(new viewer.dom.window.Event('change'));
    assert.equal(document.getElementById('follow-latest').checked, false);
    viewer.addTurn(); await viewer.poll();
    assert.equal(selection.value, '0');
    const follow = document.getElementById('follow-latest');
    follow.checked = true; follow.dispatchEvent(new viewer.dom.window.Event('change'));
    await viewer.poll();
    assert.equal(selection.value, '2');
  } finally { viewer.dom.window.close(); }
});

test('workspace and title filters restore from URL and do not change the analyzed session', async () => {
  const viewer = await createViewer('?sessionId=first&workspace=%2Fwork%2Fbeta&search=浏览器');
  try {
    const document = viewer.dom.window.document;
    assert.equal(document.querySelectorAll('#session-list .session-button').length, 1);
    assert.match(document.getElementById('session-list').textContent, /浏览器分析/);
    assert.equal(document.getElementById('live-session').value, 'first');
    const search = document.getElementById('session-search');
    search.value = 'no match'; search.dispatchEvent(new viewer.dom.window.Event('input'));
    assert.match(document.getElementById('session-list').textContent, /没有匹配/);
    assert.equal(new URL(viewer.dom.window.location.href).searchParams.get('search'), 'no match');
    await viewer.poll();
    assert.equal(document.getElementById('live-session').value, 'first');
  } finally { viewer.dom.window.close(); }
});
