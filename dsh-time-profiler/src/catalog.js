/** Workspace/session presentation metadata comes from DSH's canonical title projection. */
export class SessionCatalog {
  constructor(query, refreshMs) {
    this.query = query;
    this.refreshMs = refreshMs;
    this.expiresAt = 0;
    this.titles = new Map();
  }

  /** Coalesce title scans; runtime state is still refreshed on every list request. */
  async list() {
    const records = await this.query.listSessions();
    if (Date.now() >= this.expiresAt || records.some(record => !this.titles.has(record.header.id))) {
      this.pending ??= this.query.readTitleSnapshots(records.map(record => record.header.id)).then(results => {
        this.titles = new Map(results.map(result => [result.sessionId,
          result.status === 'fulfilled' ? result.value.title?.title : undefined]));
        this.expiresAt = Date.now() + this.refreshMs;
      }).finally(() => { this.pending = undefined; });
      await this.pending;
    }
    return records.map(record => ({ id: record.header.id, title: this.titles.get(record.header.id),
      workspace: record.header.cwd ?? '', createdAt: record.header.createdAt,
      parentSession: record.header.parentSession, origin: record.header.origin }));
  }
}
