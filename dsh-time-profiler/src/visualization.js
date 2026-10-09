/** Build an offline dashboard with an embedded report and no remote dependencies. */
import { readFile } from 'node:fs/promises';

const template = readFile(new URL('../viewer/dashboard.html', import.meta.url), 'utf8');

/** Escape JSON for an HTML script element; untrusted names must not end the element. */
export async function renderDashboard(reports = [], liveConfig = null) {
  const serialized = JSON.stringify(reports).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const live = JSON.stringify(liveConfig).replaceAll('<', '\\u003c');
  return (await template).replace('__DSH_REPORTS__', () => serialized).replace('__DSH_LIVE__', () => live);
}
