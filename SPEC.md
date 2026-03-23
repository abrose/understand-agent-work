# depgraph — Spec v0.2

> **Changelog from v0.1**: Replaced single-file HTML output with a persistent graph database backend and local server. The tool is now stateful, incrementally updatable, and queryable rather than a one-shot renderer.

---

## Overview

`depgraph` is a local dev tool that builds and maintains a **persistent graph database** of a TypeScript/JavaScript codebase. It runs as a background server, keeps the graph in sync with code changes via file watching, and exposes a React UI at `localhost:3000` for interactive exploration.

It operates at two levels of detail:

- **Module view** — which files import which (the "map" of the codebase)
- **Symbol view** — which functions/classes call which, revealed by clicking into a module

It also maintains a **git history layer** — the graph at each of the last N commits is stored, enabling a timeline view that shows how the architecture evolved over time.

---

## Goals

- Parse any TS/JS project once, persist the graph, then update incrementally on file changes
- Two levels of graph detail: file-level imports and intra-file symbol calls
- Git history: store graph snapshots for the last N commits, with a timeline UI
- Query the graph directly (e.g. "what imports `auth/index.ts`?", "find all circular dependencies")
- Serve a rich React UI from `localhost:3000` — no static file limitations
- Zero infrastructure requirements: everything runs locally, no Docker, no cloud

## Non-goals (v1)

- Multi-language support (Python, Go, etc.)
- Cross-file symbol call resolution (tracing `foo()` across module boundaries)
- Monorepo workspace-aware dependency graphing
- Deployment / sharing outside localhost
- Authentication or multi-user support

---

## Architecture

```
                          ┌─────────────────────────────────────────┐
                          │              depgraph daemon              │
                          │                                           │
  $ depgraph init ───────▶│  ┌──────────┐    ┌─────────────────┐    │
  $ depgraph watch        │  │  Parser  │───▶│  Graph Builder  │    │
  $ depgraph history      │  │ ts-morph │    │  (nodes+edges)  │    │
                          │  └──────────┘    └────────┬────────┘    │
                          │       ▲                   │             │
                          │  ┌────┴─────┐             ▼             │
                          │  │ chokidar │    ┌─────────────────┐    │
                          │  │  watcher │    │   Kuzu (graph)  │    │
                          │  └──────────┘    │ + SQLite (meta) │    │
                          │                  └────────┬────────┘    │
                          │                           │             │
                          │                  ┌────────▼────────┐    │
                          │                  │  Express API    │    │
                          │                  │  /api/graph     │    │
                          │                  │  /api/query     │    │
                          │                  │  /api/history   │    │
                          │                  └────────┬────────┘    │
                          └───────────────────────────┼─────────────┘
                                                      │
                                            ┌─────────▼────────┐
                                            │   React UI        │
                                            │  localhost:3000   │
                                            │  (D3 + shadcn/ui) │
                                            └──────────────────┘
```

Four distinct layers, each independently testable:

- **Parser** — ts-morph AST extraction; produces raw import/symbol data per file
- **Graph Builder** — normalizes parser output into typed nodes and edges; handles path resolution
- **Storage** — Kuzu for the graph itself; SQLite for project metadata, commit history, and file stats
- **API + UI** — Express serves graph queries over REST; React frontend renders the visualization

---

## CLI Interface

```bash
# First-time setup: parse the project and populate the DB
depgraph init ./src

# Start the background watcher + UI server
depgraph serve
# → Watching ./src for changes
# → UI available at http://localhost:3000

# Backfill git history (last 10 commits by default)
depgraph history
depgraph history --n 20

# One-off queries from the terminal (without opening the UI)
depgraph query "MATCH (a)-[:IMPORTS]->(b) WHERE b.path = 'src/auth/index.ts' RETURN a.path"

# Stop the background server
depgraph stop

# Wipe and re-parse from scratch
depgraph reset && depgraph init ./src
```

### Exit codes

- `0` — success
- `1` — no TS/JS files found in target directory
- `2` — parse error (logged to stderr with file + line number)
- `3` — server already running / port conflict

---

## Storage

### Kuzu (graph database)

Kuzu is an **embedded** graph database — no server process, no Docker, files live on disk next to the project. It uses a Cypher-like query language and is optimized for in-process analytical graph workloads.

All graph data lives in Kuzu: nodes, edges, symbols, and per-commit snapshots.

**Schema:**

```cypher
-- Node tables
CREATE NODE TABLE File (
  id       STRING PRIMARY KEY,   -- relative path, e.g. "src/auth/index.ts"
  label    STRING,               -- filename without extension
  dir      STRING,               -- parent directory, e.g. "src/auth"
  loc      INT64,                -- lines of code
  parsed_at TIMESTAMP
);

CREATE NODE TABLE Symbol (
  id       STRING PRIMARY KEY,   -- "src/auth/index.ts::validateToken"
  name     STRING,
  kind     STRING,               -- "function" | "class" | "arrow" | "method"
  file_id  STRING                -- FK to File.id
);

CREATE NODE TABLE Commit (
  hash     STRING PRIMARY KEY,   -- short hash, e.g. "a3f9c12"
  message  STRING,
  author   STRING,
  date     TIMESTAMP
);

-- Edge tables
CREATE REL TABLE IMPORTS (
  FROM File TO File,
  named_imports STRING[],        -- e.g. ["validateToken", "AuthError"]
  line          INT64
);

CREATE REL TABLE CALLS (
  FROM Symbol TO Symbol,
  line INT64
);

CREATE REL TABLE SNAPSHOT (
  FROM Commit TO File,           -- which files existed at this commit
  content_hash STRING            -- SHA of file content at that commit
);
```

**Example queries:**

```cypher
-- What does src/auth/index.ts import?
MATCH (a:File {id: "src/auth/index.ts"})-[:IMPORTS]->(b:File)
RETURN b.id, b.label;

-- Find all files that import from the auth directory
MATCH (a:File)-[:IMPORTS]->(b:File)
WHERE b.dir STARTS WITH "src/auth"
RETURN a.id ORDER BY a.id;

-- Detect circular imports (cycles of length 2)
MATCH (a:File)-[:IMPORTS]->(b:File)-[:IMPORTS]->(a)
RETURN a.id, b.id;

-- Most imported files (by in-degree)
MATCH (b:File)<-[r:IMPORTS]-()
RETURN b.id, count(r) AS import_count
ORDER BY import_count DESC LIMIT 10;

-- Shortest import path between two files
MATCH p = shortestPath(
  (a:File {id: "src/ui/Button.tsx"})-[:IMPORTS*]->(b:File {id: "src/api/client.ts"})
)
RETURN p;
```

### SQLite (metadata)

SQLite stores things that are relational, not graph-shaped:

- Project configuration (root path, exclude patterns, last parsed timestamp)
- Per-file parse error log (file, line, error message, timestamp)
- Watcher state (last seen modification times for incremental updates)
- UI preferences (last selected node, zoom level, layout positions)

```sql
CREATE TABLE project (
  id          TEXT PRIMARY KEY DEFAULT 'default',
  root        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  last_parsed TEXT
);

CREATE TABLE parse_errors (
  file        TEXT,
  line        INTEGER,
  message     TEXT,
  occurred_at TEXT
);

CREATE TABLE file_mtimes (
  path   TEXT PRIMARY KEY,
  mtime  INTEGER NOT NULL
);
```

Both database files live in a `.depgraph/` directory at the project root, which should be added to `.gitignore`.

---

## Parsing Approach

Unchanged from v0.1 — **`ts-morph`** handles both JS and TS. The key addition is that parsed output is written to Kuzu rather than returned as an in-memory JSON object.

### Incremental updates

On file change events from `chokidar`:

1. Delete the changed file's `File` node and all its `IMPORTS` edges from Kuzu (cascade)
2. Delete all `Symbol` nodes for that file and their `CALLS` edges
3. Re-parse the file with ts-morph
4. Insert new nodes and edges

This keeps the graph current with near-zero overhead — only the changed file is ever re-processed.

```typescript
watcher.on('change', async (filePath) => {
  const relPath = path.relative(rootDir, filePath);
  await kuzu.query(`MATCH (f:File {id: $id}) DETACH DELETE f`, { id: relPath });
  await kuzu.query(`MATCH (s:Symbol) WHERE s.file_id = $id DETACH DELETE s`, { id: relPath });
  const parsed = parser.parseFile(filePath);
  await builder.insertFile(parsed);
});
```

### Git history backfill

`depgraph history` reads the last N commits using `simple-git` and reconstructs the graph at each commit without touching the working tree:

```typescript
const log = await git.log({ maxCount: n });
for (const commit of log.all) {
  const files = await git.raw(['ls-tree', '-r', '--name-only', commit.hash]);
  const sources = await Promise.all(
    files.split('\n')
      .filter(f => /\.(ts|tsx|js|jsx)$/.test(f))
      .map(async (f) => ({
        path: f,
        content: await git.show([`${commit.hash}:${f}`])
      }))
  );
  // Parse each file from in-memory string (ts-morph useInMemoryFileSystem)
  // Write SNAPSHOT edges from Commit node to each File node
}
```

---

## API

The Express server exposes three route groups:

### `GET /api/graph`

Returns the full current graph for the initial UI load.

```
GET /api/graph
→ { nodes: File[], edges: ImportEdge[], meta: ProjectMeta }

GET /api/graph/file/:id
→ { file: File, imports: File[], importedBy: File[], symbols: Symbol[], calls: CallEdge[] }
```

### `POST /api/query`

Accepts a raw Cypher query string and returns results. Intended for power users and Claude Code integration.

```
POST /api/query
Body: { cypher: "MATCH (f:File) RETURN f.id, f.loc ORDER BY f.loc DESC LIMIT 5" }
→ { columns: string[], rows: any[][] }
```

### `GET /api/history`

Returns the list of stored commits and can reconstruct the graph at a specific commit.

```
GET /api/history
→ { commits: Commit[] }

GET /api/history/:hash
→ { nodes: File[], edges: ImportEdge[] }   -- graph state at that commit
```

---

## UI

A React SPA served from `localhost:3000`. Fetches data from the local API — no data is baked in at build time.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  depgraph  [search.....................] [Timeline ●──────○] Now │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                   │
│  Sidebar     │               Module Graph                       │
│  ─────────   │        (D3 force-directed, zoomable)             │
│  Filters     │                                                   │
│  • Directory │   ● src/auth/index.ts  ←── [selected node]       │
│  • In-degree │         │                                         │
│  • Has cycle │         ▼                                         │
│              │   ● src/utils/jwt.ts                             │
│  Stats       │                                                   │
│  83 files    │                                                   │
│  214 edges   ├──────────────────────────────────────────────────┤
│  3 cycles    │  Symbol Panel (slides in on node click)          │
│              │  validateToken() ──calls──▶ decodeJwt()          │
└──────────────┴──────────────────────────────────────────────────┘
```

### Timeline slider

When git history is available, a slider appears in the header. Dragging it queries `/api/history/:hash` and transitions the graph to that commit's state using D3 enter/exit animations — nodes that appear grow in, nodes that disappear shrink out, with edges animating along.

The slider shows commit messages as tooltips on hover.

### Visual encoding

| Property | Encoding |
|---|---|
| Node size | Proportional to in-degree (how many files import this one) |
| Node color | Hue by directory — all `src/auth/*` files share a color |
| Node border | Red dashed border if the file is part of a circular import cycle |
| Edge opacity | Fades for edges far from the selected node |
| Edge thickness | Proportional to number of named imports |

### Interactivity

- **Drag** nodes to reposition; positions persist in SQLite
- **Scroll** to zoom
- **Click** a node to open the symbol panel and highlight its import neighborhood
- **Search** filters nodes by filename in real-time (queries the API, not the DOM)
- **Directory filter** in sidebar collapses entire subtrees
- **Timeline slider** morphs graph between commit snapshots

---

## Implementation Phases

### Phase 1 — Foundation (DB + file-level graph)
- Project scaffolding: `packages/core`, `packages/server`, `packages/ui`
- Kuzu + SQLite setup with schema creation on `init`
- ts-morph import extraction → Kuzu insert
- Express API: `/api/graph` endpoint
- Minimal React UI: D3 force graph with drag, zoom, hover tooltips
- `depgraph init` + `depgraph serve` CLI commands

### Phase 2 — Incremental watching + symbol drill-down
- `chokidar` file watcher with incremental DB updates
- Symbol extraction (functions, classes, arrow fns) + `CALLS` edges
- Symbol panel in the UI (slide-in on node click)
- `depgraph watch` command (keeps server alive, reloads UI on graph change via WebSocket)

### Phase 3 — Git history
- `simple-git` integration + in-memory ts-morph parsing
- `Commit` + `SNAPSHOT` schema in Kuzu
- `/api/history` endpoints
- Timeline slider in UI with D3 enter/exit transitions
- `depgraph history --n` command

### Phase 4 — Query interface + polish
- `/api/query` endpoint with raw Cypher passthrough
- Sidebar filters (directory, in-degree threshold, cycle-only)
- Circular dependency detection + visual flagging
- Node position persistence in SQLite
- `depgraph query` CLI command

---

## Dependencies

```json
{
  "dependencies": {
    "ts-morph": "^22.0.0",
    "kuzu": "^0.6.0",
    "better-sqlite3": "^9.0.0",
    "express": "^4.19.0",
    "chokidar": "^3.6.0",
    "simple-git": "^3.25.0",
    "commander": "^12.0.0",
    "ws": "^8.17.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.0",
    "@types/better-sqlite3": "^7.6.0",
    "vite": "^5.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "d3": "^7.9.0",
    "@shadcn/ui": "latest"
  }
}
```

---

## File Structure

```
depgraph/
├── packages/
│   ├── core/                   # Parser + graph builder (no I/O dependencies)
│   │   ├── src/
│   │   │   ├── parser.ts       # ts-morph AST extraction
│   │   │   ├── builder.ts      # Kuzu insert logic
│   │   │   ├── history.ts      # simple-git + in-memory parsing
│   │   │   └── types.ts        # Shared types
│   │   └── package.json
│   │
│   ├── server/                 # Express API + file watcher
│   │   ├── src/
│   │   │   ├── index.ts        # CLI entry point (commander)
│   │   │   ├── db.ts           # Kuzu + SQLite init and connection
│   │   │   ├── watcher.ts      # chokidar incremental update loop
│   │   │   ├── routes/
│   │   │   │   ├── graph.ts
│   │   │   │   ├── query.ts
│   │   │   │   └── history.ts
│   │   │   └── ws.ts           # WebSocket for live UI reload
│   │   └── package.json
│   │
│   └── ui/                     # React frontend (Vite)
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ModuleGraph.tsx      # D3 force graph
│       │   │   ├── SymbolPanel.tsx      # Slide-in call graph
│       │   │   ├── TimelineSlider.tsx
│       │   │   └── Sidebar.tsx
│       │   └── hooks/
│       │       ├── useGraph.ts          # /api/graph fetcher
│       │       └── useHistory.ts        # /api/history fetcher
│       ├── index.html
│       └── package.json
│
├── .depgraph/                  # Created at runtime, add to .gitignore
│   ├── graph.kuzu/             # Kuzu database files
│   └── meta.sqlite             # SQLite metadata
│
├── package.json                # Workspace root
├── tsconfig.json
└── README.md
```
