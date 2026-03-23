import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { Database as KuzuDatabase, Connection as KuzuConnection } from 'kuzu';
import { GraphBuilder } from '@depgraph/core';
import type { GraphDB, QueryResult } from '@depgraph/core';

const DEPGRAPH_DIR = '.depgraph';

export interface DBContext {
  kuzuDb: KuzuDatabase;
  kuzuConn: KuzuConnection;
  sqlite: Database.Database;
  builder: GraphBuilder;
  depgraphDir: string;
}

class KuzuGraphDB implements GraphDB {
  constructor(private conn: KuzuConnection) {}

  async query(cypher: string, params?: Record<string, unknown>): Promise<QueryResult> {
    const result = await this.conn.execute(cypher, params ?? {});
    return {
      async getAll(): Promise<Record<string, unknown>[]> {
        const rows: Record<string, unknown>[] = [];
        while (result.hasNext()) {
          const row = result.getNext();
          rows.push(row as Record<string, unknown>);
        }
        return rows;
      },
    };
  }
}

export async function initDB(projectRoot: string): Promise<DBContext> {
  const depgraphDir = path.join(projectRoot, DEPGRAPH_DIR);
  const kuzuPath = path.join(depgraphDir, 'graph.kuzu');
  const sqlitePath = path.join(depgraphDir, 'meta.sqlite');

  // Ensure directories exist
  fs.mkdirSync(kuzuPath, { recursive: true });

  // Initialize Kuzu
  const kuzuDb = new KuzuDatabase(kuzuPath);
  const kuzuConn = new KuzuConnection(kuzuDb);

  // Initialize SQLite
  const sqlite = new Database(sqlitePath);
  sqlite.pragma('journal_mode = WAL');

  // Create SQLite tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS project (
      id          TEXT PRIMARY KEY DEFAULT 'default',
      root        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      last_parsed TEXT
    );

    CREATE TABLE IF NOT EXISTS parse_errors (
      file        TEXT,
      line        INTEGER,
      message     TEXT,
      occurred_at TEXT
    );

    CREATE TABLE IF NOT EXISTS file_mtimes (
      path   TEXT PRIMARY KEY,
      mtime  INTEGER NOT NULL
    );
  `);

  // Create Kuzu graph builder
  const graphDB = new KuzuGraphDB(kuzuConn);
  const builder = new GraphBuilder(graphDB);
  await builder.initSchema();

  return { kuzuDb, kuzuConn, sqlite, builder, depgraphDir };
}

export function saveProjectMeta(
  sqlite: Database.Database,
  root: string
): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR REPLACE INTO project (id, root, created_at, last_parsed) VALUES ('default', ?, ?, ?)`
    )
    .run(root, now, now);
}

export function updateLastParsed(sqlite: Database.Database): void {
  sqlite
    .prepare(`UPDATE project SET last_parsed = ? WHERE id = 'default'`)
    .run(new Date().toISOString());
}

export function logParseError(
  sqlite: Database.Database,
  file: string,
  line: number,
  message: string
): void {
  sqlite
    .prepare(
      `INSERT INTO parse_errors (file, line, message, occurred_at) VALUES (?, ?, ?, ?)`
    )
    .run(file, line, message, new Date().toISOString());
}
