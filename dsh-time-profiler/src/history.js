/** Replay canonical history separately from runtime observers; historical events cannot recreate monotonic spans. */
import { TimingAnalyzer } from './analyzer.js';

export class SessionHistory {
  constructor(query, limit) {
    this.query = query;
    this.limit = limit;
    this.cache = new Map();
  }

  /** Load one immutable session cut, releasing the query lease even when replay fails. */
  async read(sessionId, includeHistory = false) {
    const observation = await this.query.observeSession(sessionId, { projectionMode: 'none' });
    try {
      if (includeHistory) return { header: observation.header, events: observation.events };
      let cached = this.cache.get(sessionId);
      if (!cached || cached.cursor !== observation.cursor) {
        // Replay only appended events on each poll; long histories are folded once.
        const previous = cached && observation.cursor >= cached.cursor ? cached : undefined;
        const analyzer = previous?.analyzer ?? new TimingAnalyzer();
        const reports = previous?.reports ?? [];
        for (const event of observation.events.slice(previous ? previous.cursor + 1 : 0)) {
          const report = analyzer.consume(sessionId, event);
          if (report) {
            report.measurementSource = 'history';
            reports.push(report);
            if (reports.length > this.limit) reports.shift();
          }
        }
        cached = { cursor: observation.cursor, analyzer, reports };
        // Bound session caches as well as retained turns.
        if (!this.cache.has(sessionId) && this.cache.size >= this.limit) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(sessionId, cached);
      }
      const active = cached.analyzer.snapshot(sessionId);
      if (active) active.measurementSource = 'history';
      return active ? [...cached.reports, active] : cached.reports;
    } finally {
      observation[Symbol.dispose]();
    }
  }
}
