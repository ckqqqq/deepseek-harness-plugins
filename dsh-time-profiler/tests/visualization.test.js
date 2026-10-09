import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { renderDashboard } from '../src/visualization.js';

function fixture(overrides = {}) {
  return { schemaVersion: 1, sessionId: 'visual-test', turn: 1, startedAt: 1000, endedAt: 5000, durationMs: 4000,
    endReason: 'completed', unfinishedToolCount: 0,
    steps: [{ step: 1, startedAt: 1000, durationMs: 4000, stepToAssistantMs: 1000, attempts: 2 }],
    tools: [{ name: 'shell', step: 1, startedAt: 2000, durationMs: 2000, isError: false },
      { name: 'search', step: 1, startedAt: 2100, durationMs: 1000, isError: true }], ...overrides };
}
async function dashboard(reports) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(await renderDashboard(reports), { runScripts: 'dangerously', virtualConsole });
  assert.deepEqual(errors, []);
  return dom;
}

test('embedded report renders metrics, overlapping timeline and comparison selection', async () => {
  const dom = await dashboard([fixture(), fixture({ turn: 2, durationMs: 3000, endedAt: 4000 })]);
  try {
    const document = dom.window.document;
    assert.equal(document.querySelectorAll('.card').length, 4);
    assert.equal(document.querySelectorAll('#timeline .lane').length, 4);
    const bars = document.querySelectorAll('#timeline .bar');
    assert.equal(bars[2].style.left, '25%');
    assert.equal(bars[2].style.width, '50%');
    assert.equal(document.querySelectorAll('#comparison tr').length, 2);
    document.querySelectorAll('#comparison button')[1].click();
    assert.match(document.getElementById('selection').textContent, /第 2 轮/);
    assert.equal(document.querySelector('.card strong').textContent, '3.00 s');
    const select = document.getElementById('ranking');
    select.value = 'maxMs'; select.dispatchEvent(new dom.window.Event('change'));
    assert.match(document.getElementById('tools').textContent, /shell/);
  } finally { dom.window.close(); }
});

test('untrusted report labels are text and cannot inject scripts', async () => {
  const malicious = '</script><script>window.compromised=true</script><img src=x onerror="window.compromised=true">';
  const dom = await dashboard([fixture({ sessionId: malicious, tools: [{ name: malicious, step: 1, startedAt: 2000, durationMs: 500, isError: false }] })]);
  try {
    assert.equal(dom.window.compromised, undefined);
    assert.equal(dom.window.document.querySelectorAll('img').length, 0);
    assert.equal(dom.window.document.querySelector('.rank-name').firstChild.textContent, malicious);
  } finally { dom.window.close(); }
});

test('empty page offers clearly marked demo and invalid embedded reports show errors', async () => {
  const dom = await dashboard([]);
  try {
    assert.match(dom.window.document.getElementById('selection').textContent, /尚无报告/);
    dom.window.document.getElementById('demo').click();
    assert.match(dom.window.document.getElementById('selection').textContent, /演示数据/);
    assert.equal(dom.window.document.querySelectorAll('#comparison tr').length, 2);
    dom.window.document.getElementById('demo').click();
    assert.equal(dom.window.document.querySelectorAll('#comparison tr').length, 2);
  } finally { dom.window.close(); }
  const invalid = await dashboard([fixture({ durationMs: '4000' })]);
  try { assert.match(invalid.window.document.getElementById('errors').textContent, /不是有效/); }
  finally { invalid.window.close(); }
});

test('file import accepts good reports and reports bad files without losing current data', async () => {
  const dom = await dashboard([fixture()]);
  try {
    const document = dom.window.document;
    const input = document.getElementById('files');
    Object.defineProperty(input, 'files', { value: [
      { name: 'valid.json', size: 100, text: async () => JSON.stringify(fixture({ turn: 3 })) },
      { name: 'invalid.json', size: 50, text: async () => '{broken' },
    ] });
    input.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelectorAll('#comparison tr').length, 2);
    assert.match(document.getElementById('selection').textContent, /第 3 轮/);
    assert.match(document.getElementById('errors').textContent, /invalid.json/);
  } finally { dom.window.close(); }
});

test('baseline differences, folding and tool selection explain timing changes', async () => {
  const dom = await dashboard([fixture(), fixture({ turn: 2, durationMs: 3000, endedAt: 4000 })]);
  try {
    const document = dom.window.document;
    document.querySelectorAll('#comparison button')[1].click();
    assert.match(document.getElementById('delta').textContent, /减少 1.00 s（25.0%）/);
    document.querySelector('#timeline .lane:nth-child(3) button').click();
    assert.equal(document.querySelectorAll('#timeline .lane').length, 2);
    document.querySelector('#timeline .lane:nth-child(3) button').click();
    assert.equal(document.querySelectorAll('#timeline .lane').length, 4);
    document.querySelector('#timeline .lane:nth-child(4) button').click();
    assert.match(document.getElementById('span-detail').textContent, /shell.*耗时 2.00 s/);
  } finally { dom.window.close(); }
});

test('reimport replaces a measured turn instead of duplicating it', async () => {
  const dom = await dashboard([fixture()]);
  try {
    const input = dom.window.document.getElementById('files');
    Object.defineProperty(input, 'files', { value: [{ name: 'same.json', size: 100, text: async () => JSON.stringify(fixture()) }] });
    input.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(dom.window.document.querySelectorAll('#comparison tr').length, 1);
  } finally { dom.window.close(); }
});

test('live allocation and execution timelines display demo timing and reject malformed runtime data', async () => {
  const dom = await dashboard([]);
  try {
    const document = dom.window.document;
    document.getElementById('demo').click();
    assert.match(document.getElementById('runtime-allocation').textContent, /仅 LLM 5.50 s/);
    assert.match(document.getElementById('runtime-allocation').textContent, /仅工具 6.00 s/);
    assert.match(document.getElementById('runtime-summary').textContent, /模型尝试 2 次/);
    assert.equal(document.querySelectorAll('#runtime-timeline .lane').length, 5);
    assert.match(document.getElementById('execution-ranking').textContent, /shell/);
  } finally { dom.window.close(); }
  const invalid = await dashboard([fixture({runtimeTiming: {clock:'monotonic'}})]);
  try { assert.match(invalid.window.document.getElementById('errors').textContent, /运行时计时字段无效/); }
  finally { invalid.window.close(); }
});
