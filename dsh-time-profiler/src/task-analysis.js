/** Analyze explicitly selected turn reports; selection, not a guessed session boundary, defines the task. */
import { durationStatistics } from './runtime-timing.js';

export function analyzeTask(reports) {
  const measured = reports.filter(report => report.runtimeTiming !== undefined);
  const totals = { llmOnlyMs: 0, toolOnlyMs: 0, overlapMs: 0, otherMs: 0, durationMs: 0, llmCumulativeMs: 0, llmAttemptCount: 0, failedAttemptCount: 0 };
  const toolMap = new Map();
  for (const report of measured) {
    const timing = report.runtimeTiming;
    for (const key of Object.keys(totals)) totals[key] += timing[key];
    for (const tool of timing.toolsByName) {
      const aggregate = toolMap.get(tool.name) ?? { name: tool.name, count: 0, totalMs: 0, maxMs: 0, errors: 0, incomplete: 0 };
      aggregate.count += tool.count; aggregate.totalMs += tool.totalMs; aggregate.maxMs = Math.max(aggregate.maxMs, tool.maxMs);
      aggregate.errors += tool.errors; aggregate.incomplete += tool.incomplete;
      toolMap.set(tool.name, aggregate);
    }
  }
  const tools = [...toolMap.values()].map(tool => ({ ...tool, meanMs: tool.totalMs / tool.count })).sort((left, right) => right.totalMs - left.totalMs);
  const spans = measured.flatMap(report => report.runtimeTiming.spans);
  for (const tool of tools) tool.duration = durationStatistics(spans.filter(span => span.kind === 'tool' && span.name === tool.name && span.outcome !== 'open-at-turn-end').map(span => span.durationMs));
  const observations = [];
  if (totals.failedAttemptCount > 0) observations.push(`有 ${totals.failedAttemptCount} 次未提交正常消息的模型尝试；检查重试与取消原因。`);
  if (tools.length) observations.push(`累计执行时间最高的工具是 ${tools[0].name}，运行 ${tools[0].count} 次；检查重复工作和单次长调用，累计时间可能重叠。`);
  if (totals.otherMs > 0) observations.push('其他时间尚未细分；应进一步测量审批、排队、压缩和请求准备，不能将它全部归因于框架 CPU 开销。');
  return { schemaVersion: 1, selectedTurnCount: reports.length, measuredTurnCount: measured.length,
    missingTimingCount: reports.length - measured.length, sessionIds: [...new Set(reports.map(report => report.sessionId))],
    activeTime: totals, toolsByName: tools, observations,
    llmDuration: durationStatistics(spans.filter(span => span.kind === 'llm' && span.outcome !== 'open-at-turn-end').map(span => span.durationMs)),
    firstOutputWait: durationStatistics(spans.filter(span => span.kind === 'llm' && span.firstOutputMs !== undefined).map(span => span.firstOutputMs)),
    notes: ['Active time sums selected turn durations. Concurrent sessions are cumulative worker time, not task wall time.',
      'Idle gaps between turns are excluded. Use explicit task start/end and a common trace clock for cross-session wall time.',
      'No speedup is established without running the same task and checking completion quality.'] };
}
