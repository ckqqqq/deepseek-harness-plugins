/** Explicit task selection: pass the turn JSON files belonging to one benchmark run. */
import { readFile } from 'node:fs/promises';
import { analyzeTask } from '../src/task-analysis.js';
const files = process.argv.slice(2);
if (!files.length) throw new Error('Usage: npm run analyze:task -- <turn-report.json> [...]');
const reports = [];
for (const filename of files) {
  const report = JSON.parse(await readFile(filename, 'utf8'));
  if (report?.schemaVersion !== 1 || typeof report.sessionId !== 'string' || !Array.isArray(report.tools)) {
    throw new Error(`Invalid DSH report: ${filename}`);
  }
  // Run only against profiler-generated reports; malformed runtime fields fail instead of being inferred.
  const timing = report.runtimeTiming;
  if (timing && (!Array.isArray(timing.spans) || !Array.isArray(timing.toolsByName) || ['durationMs','llmOnlyMs','toolOnlyMs','overlapMs','otherMs','llmCumulativeMs','llmAttemptCount','failedAttemptCount'].some(key => !Number.isFinite(timing[key]) || timing[key] < 0))) {
    throw new Error(`Invalid runtime timing: ${filename}`);
  }
  if (timing && (timing.spans.some(span => !span || !['llm','tool'].includes(span.kind) || !Number.isFinite(span.durationMs) || span.durationMs < 0 || (span.kind === 'tool' && typeof span.name !== 'string') || (span.firstOutputMs !== undefined && (!Number.isFinite(span.firstOutputMs) || span.firstOutputMs < 0)))
    || timing.toolsByName.some(tool => !tool || typeof tool.name !== 'string' || ['count','totalMs','maxMs','errors','incomplete'].some(key => !Number.isFinite(tool[key]) || tool[key] < 0)))) {
    throw new Error(`Invalid runtime spans or tool summaries: ${filename}`);
  }
  if (!reports.some(existing => existing.sessionId === report.sessionId && existing.turn === report.turn && existing.startedAt === report.startedAt)) reports.push(report);
}
console.log(JSON.stringify(analyzeTask(reports), null, 2));
