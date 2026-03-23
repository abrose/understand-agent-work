import type { ParsedFile, FileNode, ImportEdge, SymbolNode, CallEdge } from './types.js';

export interface GraphDB {
  query(cypher: string, params?: Record<string, unknown>): Promise<QueryResult>;
}

export interface QueryResult {
  getAll(): Promise<Record<string, unknown>[]>;
}

export class GraphBuilder {
  constructor(private db: GraphDB) {}

  async initSchema(): Promise<void> {
    // Node tables
    await this.db.query(`
      CREATE NODE TABLE IF NOT EXISTS File (
        id STRING PRIMARY KEY,
        label STRING,
        dir STRING,
        loc INT64,
        parsed_at TIMESTAMP
      )
    `);

    await this.db.query(`
      CREATE NODE TABLE IF NOT EXISTS Symbol (
        id STRING PRIMARY KEY,
        name STRING,
        kind STRING,
        file_id STRING
      )
    `);

    await this.db.query(`
      CREATE NODE TABLE IF NOT EXISTS Commit (
        hash STRING PRIMARY KEY,
        message STRING,
        author STRING,
        date TIMESTAMP
      )
    `);

    // Edge tables
    await this.db.query(`
      CREATE REL TABLE IF NOT EXISTS IMPORTS (
        FROM File TO File,
        named_imports STRING[],
        line INT64
      )
    `);

    await this.db.query(`
      CREATE REL TABLE IF NOT EXISTS CALLS (
        FROM Symbol TO Symbol,
        line INT64
      )
    `);

    await this.db.query(`
      CREATE REL TABLE IF NOT EXISTS SNAPSHOT (
        FROM Commit TO File,
        content_hash STRING
      )
    `);
  }

  async insertFile(parsed: ParsedFile): Promise<void> {
    const { file, imports, symbols, calls } = parsed;

    // Insert the File node
    await this.db.query(
      `CREATE (f:File {
        id: $id,
        label: $label,
        dir: $dir,
        loc: $loc,
        parsed_at: timestamp($parsed_at)
      })`,
      {
        id: file.id,
        label: file.label,
        dir: file.dir,
        loc: file.loc,
        parsed_at: file.parsedAt.toISOString(),
      }
    );

    // Insert Symbol nodes
    for (const sym of symbols) {
      await this.db.query(
        `CREATE (s:Symbol {
          id: $id,
          name: $name,
          kind: $kind,
          file_id: $file_id
        })`,
        {
          id: sym.id,
          name: sym.name,
          kind: sym.kind,
          file_id: sym.fileId,
        }
      );
    }

    // Insert IMPORTS edges (only if target file exists)
    for (const imp of imports) {
      await this.db.query(
        `MATCH (a:File {id: $from}), (b:File {id: $to})
         CREATE (a)-[:IMPORTS {named_imports: $named_imports, line: $line}]->(b)`,
        {
          from: imp.from,
          to: imp.to,
          named_imports: imp.namedImports,
          line: imp.line,
        }
      );
    }

    // Insert CALLS edges
    for (const call of calls) {
      await this.db.query(
        `MATCH (a:Symbol {id: $from}), (b:Symbol {id: $to})
         CREATE (a)-[:CALLS {line: $line}]->(b)`,
        {
          from: call.from,
          to: call.to,
          line: call.line,
        }
      );
    }
  }

  async removeFile(fileId: string): Promise<void> {
    // Delete the file node and all its edges
    await this.db.query(
      `MATCH (f:File {id: $id}) DETACH DELETE f`,
      { id: fileId }
    );
    // Delete symbols for this file
    await this.db.query(
      `MATCH (s:Symbol) WHERE s.file_id = $id DETACH DELETE s`,
      { id: fileId }
    );
  }

  async insertImportEdges(imports: ImportEdge[]): Promise<void> {
    for (const imp of imports) {
      await this.db.query(
        `MATCH (a:File {id: $from}), (b:File {id: $to})
         CREATE (a)-[:IMPORTS {named_imports: $named_imports, line: $line}]->(b)`,
        {
          from: imp.from,
          to: imp.to,
          named_imports: imp.namedImports,
          line: imp.line,
        }
      );
    }
  }

  async getFullGraph(): Promise<{
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  }> {
    const nodesResult = await this.db.query(`MATCH (f:File) RETURN f.*`);
    const nodes = await nodesResult.getAll();

    const edgesResult = await this.db.query(
      `MATCH (a:File)-[r:IMPORTS]->(b:File) RETURN a.id AS source, b.id AS target, r.named_imports AS named_imports, r.line AS line`
    );
    const edges = await edgesResult.getAll();

    return { nodes, edges };
  }

  async getFileDetail(fileId: string): Promise<{
    file: Record<string, unknown> | null;
    imports: Record<string, unknown>[];
    importedBy: Record<string, unknown>[];
    symbols: Record<string, unknown>[];
    calls: Record<string, unknown>[];
  }> {
    const fileResult = await this.db.query(
      `MATCH (f:File {id: $id}) RETURN f.*`,
      { id: fileId }
    );
    const files = await fileResult.getAll();
    const file = files[0] ?? null;

    const importsResult = await this.db.query(
      `MATCH (f:File {id: $id})-[:IMPORTS]->(b:File) RETURN b.*`,
      { id: fileId }
    );
    const imports = await importsResult.getAll();

    const importedByResult = await this.db.query(
      `MATCH (a:File)-[:IMPORTS]->(f:File {id: $id}) RETURN a.*`,
      { id: fileId }
    );
    const importedBy = await importedByResult.getAll();

    const symbolsResult = await this.db.query(
      `MATCH (s:Symbol) WHERE s.file_id = $id RETURN s.*`,
      { id: fileId }
    );
    const symbols = await symbolsResult.getAll();

    const callsResult = await this.db.query(
      `MATCH (a:Symbol)-[r:CALLS]->(b:Symbol)
       WHERE a.file_id = $id OR b.file_id = $id
       RETURN a.id AS source, b.id AS target, r.line AS line`,
      { id: fileId }
    );
    const calls = await callsResult.getAll();

    return { file, imports, importedBy, symbols, calls };
  }

  async runQuery(cypher: string): Promise<{
    rows: Record<string, unknown>[];
  }> {
    const result = await this.db.query(cypher);
    const rows = await result.getAll();
    return { rows };
  }
}
