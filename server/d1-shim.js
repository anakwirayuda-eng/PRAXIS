class D1StatementShim {
  constructor(db, query, bindings = []) {
    this.db = db;
    this.query = query;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementShim(this.db, this.query, bindings);
  }

  async all() {
    const stmt = this.db.prepare(this.query);
    return { results: stmt.all(...this.bindings) };
  }

  async first() {
    const stmt = this.db.prepare(this.query);
    return stmt.get(...this.bindings) ?? null;
  }

  async run() {
    const stmt = this.db.prepare(this.query);
    const info = stmt.run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid ?? 0),
      },
    };
  }

  execute() {
    const stmt = this.db.prepare(this.query);
    const normalizedQuery = this.query.trim().toUpperCase();
    if (normalizedQuery.startsWith('SELECT')) {
      return { results: stmt.all(...this.bindings) };
    }
    return stmt.run(...this.bindings);
  }
}

export function createD1Shim(db) {
  return {
    prepare(query) {
      return new D1StatementShim(db, query);
    },
    async batch(statements) {
      const executeBatch = db.transaction((ops) => ops.map((op) => op.execute()));
      return executeBatch(statements);
    },
  };
}
