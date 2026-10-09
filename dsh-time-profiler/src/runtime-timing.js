/** Live, monotonic measurements; only metadata is retained, never request or tool content. */
import { performance } from 'node:perf_hooks';

/** Nearest-rank distribution of observed durations; percentiles describe this sample only. */
export function durationStatistics(values) {
  if (!values.length) return { count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((left, right) => left - right);
  return { count: sorted.length, meanMs: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
}

/** Partition a turn into disjoint intervals. Nested and parallel spans count once per category. */
export function partitionTime(durationMs, spans) {
  const boundaries = new Map([[0, { llm: 0, tool: 0 }], [durationMs, { llm: 0, tool: 0 }]]);
  for (const span of spans) {
    const start = Math.max(0, Math.min(durationMs, span.startMs));
    const end = Math.max(start, Math.min(durationMs, span.startMs + span.durationMs));
    if (end <= start) continue;
    for (const [position, change] of [[start, 1], [end, -1]]) {
      const boundary = boundaries.get(position) ?? { llm: 0, tool: 0 };
      boundary[span.kind] += change;
      boundaries.set(position, boundary);
    }
  }
  const totals = { llmOnlyMs: 0, toolOnlyMs: 0, overlapMs: 0, otherMs: 0 };
  let previous = 0, llmCount = 0, toolCount = 0;
  for (const [position, change] of [...boundaries].sort(([left], [right]) => left - right)) {
    const category = llmCount > 0 ? (toolCount > 0 ? 'overlapMs' : 'llmOnlyMs') : toolCount > 0 ? 'toolOnlyMs' : 'otherMs';
    totals[category] += position - previous;
    llmCount += change.llm; toolCount += change.tool; previous = position;
  }
  return totals;
}

/** Capture only turns whose opening edge was observed; handles cannot migrate into later turns. */
export class RuntimeTiming {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.turns = new Map();
  }
  start(sessionId) {
    this.turns.set(sessionId, { origin: this.clock(), spans: [], pending: new Set(), attempts: new Map() });
  }
  begin(sessionId, metadata) {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    const span = { ...metadata, startMs: this.clock() - turn.origin };
    const handle = { turn, span, ended: false };
    turn.pending.add(handle);
    return handle;
  }
  end(handle, outcome) {
    if (!handle || handle.ended) return;
    handle.ended = true;
    handle.span.durationMs = Math.max(0, this.clock() - handle.turn.origin - handle.span.startMs);
    handle.span.outcome = outcome;
    handle.turn.pending.delete(handle);
    handle.turn.spans.push(handle.span);
  }
  /** Stream frames identify the loop's request attempt and session without inspecting prompt contents. */
  stream(sessionId, frame) {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    if (frame.type === 'start') {
      const handle = this.begin(sessionId, { kind: 'llm', step: frame.step, attemptId: frame.attemptId });
      turn.attempts.set(frame.attemptId, handle);
    } else {
      const handle = turn.attempts.get(frame.attemptId);
      if (!handle) return;
      if (frame.type === 'chunk') {
        const chunk = frame.chunk;
        // Structural/usage frames are not tokens. A tool-call delta is observable output too.
        const hasOutput = (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') ? chunk.text.length > 0
          : chunk.type === 'tool-call-delta' && (Boolean(chunk.argumentsDelta) || Boolean(chunk.name));
        if (hasOutput && handle.span.firstOutputMs === undefined) {
          handle.span.firstOutputMs = this.clock() - turn.origin - handle.span.startMs;
        }
      } else if (frame.type === 'end') {
        this.end(handle, frame.outcome.kind === 'committed' ? frame.outcome.eventType : 'abandoned');
        turn.attempts.delete(frame.attemptId);
      }
    }
  }
  finish(sessionId) {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    const durationMs = Math.max(0, this.clock() - turn.origin);
    this.turns.delete(sessionId);
    // Outstanding work is explicitly clipped to the turn edge, not reported as completed execution.
    for (const handle of [...turn.pending]) this.end(handle, 'open-at-turn-end');
    const spans = turn.spans.map(span => ({ ...span, durationMs: Math.min(span.durationMs, Math.max(0, durationMs - span.startMs)) }));
    return summarizeTiming(durationMs, spans);
  }

  /** Snapshot open work without settling or removing the original handles. */
  snapshot(sessionId) {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    const durationMs = Math.max(0, this.clock() - turn.origin);
    const spans = [...turn.spans.map(span => ({ ...span })), ...[...turn.pending].map(handle => ({
      ...handle.span, durationMs: Math.max(0, durationMs - handle.span.startMs), outcome: 'running',
    }))];
    return summarizeTiming(durationMs, spans);
  }

  forget(sessionId) { this.turns.delete(sessionId); }
}

/** Derive completed and provisional reports using the same interval accounting. */
function summarizeTiming(durationMs, spans) {
    const llm = spans.filter(span => span.kind === 'llm');
    const tools = spans.filter(span => span.kind === 'tool');
    const toolsByName = new Map();
    for (const span of tools) {
      const summary = toolsByName.get(span.name) ?? { name: span.name, count: 0, totalMs: 0, maxMs: 0, errors: 0, incomplete: 0 };
      summary.count++; summary.totalMs += span.durationMs; summary.maxMs = Math.max(summary.maxMs, span.durationMs);
      summary.errors += Number(span.outcome === 'error'); summary.incomplete += Number(span.outcome === 'open-at-turn-end' || span.outcome === 'running');
      toolsByName.set(span.name, summary);
    }
    const partition = partitionTime(durationMs, spans);
    return { clock: 'monotonic', durationMs, ...partition, spans,
      llmAttemptCount: llm.length, llmCumulativeMs: llm.reduce((total, span) => total + span.durationMs, 0),
      llmDuration: durationStatistics(llm.filter(span => span.outcome !== 'open-at-turn-end' && span.outcome !== 'running').map(span => span.durationMs)),
      firstOutputWait: durationStatistics(llm.filter(span => span.firstOutputMs !== undefined).map(span => span.firstOutputMs)),
      failedAttemptCount: llm.filter(span => span.outcome === 'assistant/attempt' || span.outcome === 'abandoned').length,
      toolsByName: [...toolsByName.values()].map(summary => ({ ...summary, meanMs: summary.totalMs / summary.count,
        duration: durationStatistics(tools.filter(span => span.name === summary.name && span.outcome !== 'open-at-turn-end' && span.outcome !== 'running').map(span => span.durationMs)) }))
        .sort((left, right) => right.totalMs - left.totalMs),
      notes: ['LLM interval is the live assistant attempt through settlement, not HTTP-only latency.',
        'Tool interval is the tools/execute waterfall after scheduling and pre-execute policy, including nested execution and middleware.',
        'Other time includes uninstrumented model calls, preparation, approval, queueing, persistence and waits; it is not CPU overhead.',
        'Subagent LLM work is recorded in its own session; a parent waiting on a subagent remains a tool interval.'] };
  }