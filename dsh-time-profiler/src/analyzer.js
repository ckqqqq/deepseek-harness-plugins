/** Local timing projection. Content, prompts and tool arguments are never retained. */
export class TimingAnalyzer {
  constructor() {
    this.sessions = new Map();
  }

  /** Release unfinished measurements when their session is disposed. */
  forget(sessionId) {
    this.sessions.delete(sessionId);
  }

  /** Provisional report at the current wall-clock edge; the original turn remains open. */
  snapshot(sessionId, time = Date.now()) {
    const active = this.sessions.get(sessionId);
    if (!active) return;
    const projection = new TimingAnalyzer();
    projection.sessions.set(sessionId, active);
    return { ...projection.consume(sessionId, { type: 'turn/end', time,
      data: { turn: active.turn, reason: { kind: 'running' } } }), live: true };
  }

  /** Consume an ordered, live DSH session event; return a report at turn end. */
  consume(sessionId, event) {
    const { type, time, data } = event;
    if (type === 'turn/start') {
      this.sessions.set(sessionId, {
        sessionId, turn: data.turn, startedAt: time,
        steps: new Map(), calls: new Map(), tools: [],
      });
      return;
    }
    const active = this.sessions.get(sessionId);
    if (!active || data.turn !== active.turn) return;

    if (type === 'step/start') {
      active.steps.set(data.step, { step: data.step, startedAt: time, attempts: 0 });
    } else if (type === 'assistant/message' || type === 'assistant/attempt') {
      const step = active.steps.get(data.step);
      if (step) {
        step.attempts += 1;
        // This includes request preparation and retry delays, not just provider latency.
        step.stepToAssistantMs = time - step.startedAt;
        step.assistantOutcome = type;
      }
    } else if (type === 'step/end') {
      const step = active.steps.get(data.step);
      if (step) step.durationMs = time - step.startedAt;
    } else if (type === 'tool/call') {
      active.calls.set(data.callId, { name: data.name, step: data.step, startedAt: time });
    } else if (type === 'tool/result') {
      const call = active.calls.get(data.message.toolCallId);
      if (call) {
        active.tools.push({ ...call, durationMs: time - call.startedAt, isError: data.message.isError === true });
        active.calls.delete(data.message.toolCallId);
      }
    } else if (type === 'turn/end') {
      this.sessions.delete(sessionId);
      const toolsByName = new Map();
      for (const tool of active.tools) {
        const summary = toolsByName.get(tool.name) ?? { name: tool.name, count: 0, totalMs: 0, maxMs: 0, errors: 0 };
        summary.count += 1;
        summary.totalMs += tool.durationMs;
        summary.maxMs = Math.max(summary.maxMs, tool.durationMs);
        summary.errors += Number(tool.isError);
        toolsByName.set(tool.name, summary);
      }
      return {
        schemaVersion: 1, sessionId, turn: active.turn,
        startedAt: active.startedAt, endedAt: time, durationMs: time - active.startedAt,
        endReason: data.reason.kind,
        clockAnomaly: time < active.startedAt || active.tools.some(tool => tool.durationMs < 0)
          || [...active.steps.values()].some(step => step.durationMs < 0 || step.stepToAssistantMs < 0),
        steps: [...active.steps.values()], tools: active.tools,
        toolsByName: [...toolsByName.values()].map(summary => ({ ...summary, meanMs: summary.totalMs / summary.count }))
          .sort((left, right) => right.totalMs - left.totalMs),
        unfinishedToolCount: active.calls.size,
        notes: ['Tool call-to-result durations include approval, queueing and result handling.',
          'Parallel and nested tool durations overlap; totals are not turn wall time.',
          'Step-to-assistant includes preparation, model streaming and retries; it is not TTFT.',
          'Times use DSH event wall-clock timestamps; clock adjustments can distort durations.'],
      };
    }
  }
}
