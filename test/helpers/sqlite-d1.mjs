import { DatabaseSync } from "node:sqlite";

class BoundStatement {
  constructor(database, sql, args) {
    this.database = database;
    this.sql = sql;
    this.args = args;
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  }
  async first() {
    return this.database.prepare(this.sql).get(...this.args) ?? null;
  }
  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.args), meta: { changes: 0 } };
  }
  runSync() {
    const result = this.database.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  }
}

class PreparedStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }
  bind(...args) {
    return new BoundStatement(this.database, this.sql, args);
  }
}

export class SQLiteD1TestDatabase {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
  }
  prepare(sql) {
    return new PreparedStatement(this.sqlite, sql);
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  exec(sql) {
    return this.sqlite.exec(sql);
  }
  close() {
    this.sqlite.close();
  }
}
