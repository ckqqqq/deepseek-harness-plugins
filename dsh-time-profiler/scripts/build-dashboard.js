/** Regenerate the standalone empty viewer from the single maintained template. */
import { writeFile } from 'node:fs/promises';
import { renderDashboard } from '../src/visualization.js';
await writeFile(new URL('../dashboard.html', import.meta.url), await renderDashboard());
