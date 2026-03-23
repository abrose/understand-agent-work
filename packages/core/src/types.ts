export interface FileNode {
  id: string;       // relative path, e.g. "src/auth/index.ts"
  label: string;    // filename without extension
  dir: string;      // parent directory
  loc: number;      // lines of code
  parsedAt: Date;
}

export interface SymbolNode {
  id: string;       // "src/auth/index.ts::validateToken"
  name: string;
  kind: 'function' | 'class' | 'arrow' | 'method';
  fileId: string;   // FK to FileNode.id
}

export interface ImportEdge {
  from: string;          // source file id
  to: string;            // target file id
  namedImports: string[];
  line: number;
}

export interface CallEdge {
  from: string;   // source symbol id
  to: string;     // target symbol id
  line: number;
}

export interface CommitNode {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

export interface SnapshotEdge {
  commitHash: string;
  fileId: string;
  contentHash: string;
}

export interface ParsedFile {
  file: FileNode;
  imports: ImportEdge[];
  symbols: SymbolNode[];
  calls: CallEdge[];
}

export interface ProjectMeta {
  root: string;
  createdAt: string;
  lastParsed: string | null;
}
