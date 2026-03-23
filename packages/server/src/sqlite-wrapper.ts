/**
 * Thin wrapper around sql.js that mimics the better-sqlite3 synchronous API
 * used by this project. This avoids native module compilation issues across
 * different Node.js versions.
 */
import * as fs from 'fs';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
// Type declarations in ./sql.js.d.ts

export interface Statement {
  run(...params: unknown[]): void;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqliteDatabase {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(pragma: string): unknown;
  transaction<T extends (...args: any[]) => void>(fn: T): T;
  close(): void;
}

/**
 * Initialize sql.js and open (or create) a database file.
 * Must be called once at startup since sql.js WASM init is async.
 */
export async function openDatabase(filePath: string): Promise<SqliteDatabase> {
  const SQL = await initSqlJs();

  let db: SqlJsDatabase;
  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  const saveToDisk = () => {
    const data = db.export();
    fs.writeFileSync(filePath, Buffer.from(data));
  };

  const wrapStatement = (sql: string): Statement => ({
    run(...params: unknown[]) {
      db.run(sql, params as any[]);
      saveToDisk();
    },
    get(...params: unknown[]): Record<string, unknown> | undefined {
      const stmt = db.prepare(sql);
      stmt.bind(params as any[]);
      if (stmt.step()) {
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        const row: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          row[columns[i]] = values[i];
        }
        stmt.free();
        return row;
      }
      stmt.free();
      return undefined;
    },
    all(...params: unknown[]): Record<string, unknown>[] {
      const stmt = db.prepare(sql);
      stmt.bind(params as any[]);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        const row: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          row[columns[i]] = values[i];
        }
        rows.push(row);
      }
      stmt.free();
      return rows;
    },
  });

  return {
    prepare(sql: string): Statement {
      return wrapStatement(sql);
    },
    exec(sql: string): void {
      db.run(sql);
      saveToDisk();
    },
    pragma(pragma: string): unknown {
      const result = db.exec(`PRAGMA ${pragma}`);
      return result.length > 0 ? result[0].values[0]?.[0] : undefined;
    },
    transaction<T extends (...args: any[]) => void>(fn: T): T {
      return ((...args: any[]) => {
        db.run('BEGIN');
        try {
          fn(...args);
          db.run('COMMIT');
          saveToDisk();
        } catch (err) {
          db.run('ROLLBACK');
          throw err;
        }
      }) as unknown as T;
    },
    close(): void {
      saveToDisk();
      db.close();
    },
  };
}
