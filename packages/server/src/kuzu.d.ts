declare module 'kuzu' {
  class Database {
    constructor(path: string);
  }
  class Connection {
    constructor(db: Database);
    execute(query: string, params?: Record<string, unknown>): Promise<QueryResult>;
  }
  interface QueryResult {
    hasNext(): boolean;
    getNext(): Record<string, unknown>;
    getColumnNames(): string[];
    getColumnTypes(): string[];
    close(): void;
  }
  export default { Database, Connection };
  export { Database, Connection, QueryResult };
}
