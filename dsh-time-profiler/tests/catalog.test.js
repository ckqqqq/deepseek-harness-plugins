import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCatalog } from '../src/catalog.js';

test('catalog preserves canonical titles, workspace and child relationships without repeated history scans', async () => {
  let scans = 0;
  const query = {
    async listSessions() { return [{ header: { id: 'first', cwd: '/work/project', createdAt: 123, parentSession: 'parent', origin: 'subagent' } }]; },
    async readTitleSnapshots() { scans++; return [{ sessionId: 'first', status: 'fulfilled', value: { title: { title: '分析项目' } } }]; },
  };
  const catalog = new SessionCatalog(query, 30000);
  const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
  assert.equal(scans, 1);
  assert.equal(first[0].title, '分析项目');
  assert.equal(second[0].workspace, '/work/project');
  assert.equal(first[0].parentSession, 'parent');
  await catalog.list();
  assert.equal(scans, 1);
});
