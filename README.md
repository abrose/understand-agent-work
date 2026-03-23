# depgraph

A local dev tool that builds a persistent graph database of a TypeScript/JavaScript codebase. It parses imports and symbols using `ts-morph`, stores them in an embedded Kuzu graph database, and serves an interactive D3 force-directed visualization at `localhost:3000`.

## Prerequisites

- **Node.js 18+** (requires ES2022 support)
- **npm 8+** (with workspaces support)
- A TypeScript or JavaScript project to analyze

> Kuzu and better-sqlite3 are native modules and will compile during `npm install`. You may need Python 3 and a C++ toolchain (e.g. `build-essential` on Ubuntu, Xcode CLT on macOS) if prebuilt binaries aren't available for your platform.

## Installation

```bash
git clone <repo-url> depgraph
cd depgraph
npm install
npm run build
```

This builds all three packages:

| Package | Description |
|---------|-------------|
| `@depgraph/core` | ts-morph parser + Kuzu graph builder |
| `@depgraph/server` | Express API, CLI entry point, file watcher |
| `@depgraph/ui` | React + D3 frontend (built by Vite) |

## Quick Start

### 1. Initialize the graph

Point `depgraph init` at the source directory of any TS/JS project:

```bash
# Analyze a local project
node packages/server/dist/index.js init /path/to/your-project/src
```

This will:
- Recursively find all `.ts`, `.tsx`, `.js`, and `.jsx` files
- Parse imports and symbols from each file using ts-morph
- Store the file-level and symbol-level graph in Kuzu (`.depgraph/graph.kuzu/`)
- Store project metadata in SQLite (`.depgraph/meta.sqlite`)

The `.depgraph/` directory is created inside the target project's root.

### 2. Start the server

```bash
node packages/server/dist/index.js serve
```

This starts:
- An Express API on `http://localhost:3000`
- A file watcher (chokidar) that incrementally updates the graph on code changes
- A WebSocket server that pushes live updates to the UI

Open **http://localhost:3000** in your browser to see the interactive graph.

#### Custom port

```bash
node packages/server/dist/index.js serve --port 4000
```

### 3. Query the graph from the terminal

Run Cypher queries directly without opening the browser:

```bash
# What files does auth/index.ts import?
node packages/server/dist/index.js query \
  'MATCH (a:File {id: "src/auth/index.ts"})-[:IMPORTS]->(b:File) RETURN b.id'

# Find the most imported files
node packages/server/dist/index.js query \
  'MATCH (b:File)<-[r:IMPORTS]-() RETURN b.id, count(r) AS imports ORDER BY imports DESC LIMIT 10'

# Detect circular imports (cycles of length 2)
node packages/server/dist/index.js query \
  'MATCH (a:File)-[:IMPORTS]->(b:File)-[:IMPORTS]->(a) RETURN a.id, b.id'

# Largest files by lines of code
node packages/server/dist/index.js query \
  'MATCH (f:File) RETURN f.id, f.loc ORDER BY f.loc DESC LIMIT 10'

# All files in a directory
node packages/server/dist/index.js query \
  'MATCH (f:File) WHERE f.dir STARTS WITH "src/auth" RETURN f.id'
```

### 4. Reset and re-parse

```bash
node packages/server/dist/index.js reset
node packages/server/dist/index.js init /path/to/your-project/src
```

## CLI Reference

All commands are run via `node packages/server/dist/index.js <command>`.

| Command | Description |
|---------|-------------|
| `init <dir>` | Parse a project directory and populate the graph database |
| `serve` | Start the watcher + API server + UI |
| `query <cypher>` | Run a Cypher query and print results as JSON |
| `reset` | Delete the `.depgraph/` directory and start fresh |
| `stop` | Stop the background server (use Ctrl+C for now) |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | No TS/JS files found, or `.depgraph/` directory missing |
| `2` | Cypher query execution error |
| `3` | Port already in use |

## REST API

When `depgraph serve` is running, the following endpoints are available:

### `GET /api/graph`

Returns the full dependency graph for the initial UI load.

```json
{
  "nodes": [
    { "f.id": "src/index.ts", "f.label": "index", "f.dir": "src", "f.loc": 42 }
  ],
  "edges": [
    { "source": "src/index.ts", "target": "src/utils.ts", "named_imports": ["helper"], "line": 3 }
  ],
  "meta": { "root": "/path/to/project", "created_at": "...", "last_parsed": "..." }
}
```

### `GET /api/graph/file/:id`

Returns details for a single file — its imports, importers, symbols, and call edges.

```
GET /api/graph/file/src/auth/index.ts
```

```json
{
  "file": { "f.id": "src/auth/index.ts", "f.label": "index", "f.dir": "src/auth", "f.loc": 120 },
  "imports": [ { "b.id": "src/utils/jwt.ts" } ],
  "importedBy": [ { "a.id": "src/app.ts" } ],
  "symbols": [ { "s.id": "src/auth/index.ts::validateToken", "s.name": "validateToken", "s.kind": "function" } ],
  "calls": [ { "source": "src/auth/index.ts::validateToken", "target": "src/auth/index.ts::decodeJwt", "line": 15 } ]
}
```

### `POST /api/query`

Execute a raw Cypher query against the Kuzu graph.

```bash
curl -X POST http://localhost:3000/api/query \
  -H 'Content-Type: application/json' \
  -d '{"cypher": "MATCH (f:File) RETURN f.id, f.loc ORDER BY f.loc DESC LIMIT 5"}'
```

```json
{
  "rows": [
    { "f.id": "src/app.ts", "f.loc": 350 },
    { "f.id": "src/auth/index.ts", "f.loc": 120 }
  ]
}
```

### `GET /api/history`

Returns stored git commit snapshots (populated by a future `depgraph history` command).

### `GET /api/history/:hash`

Returns the graph state at a specific commit.

## Testing on a Real Codebase

Here's a step-by-step walkthrough using a real open source project.

### Example: Analyze Express.js itself

```bash
# Clone a project to analyze
git clone https://github.com/expressjs/express.git /tmp/express-test
cd /path/to/depgraph

# Build depgraph
npm install && npm run build

# Initialize the graph (point at the source directory)
node packages/server/dist/index.js init /tmp/express-test

# Start the server
node packages/server/dist/index.js serve
```

Open http://localhost:3000 — you'll see the module graph rendered as an interactive force-directed layout.

### What to look for in the UI

- **Node size** reflects how many files import it (in-degree)
- **Node color** groups files by directory (all `lib/` files share a hue)
- **Click** a node to open the symbol panel, showing functions/classes and their call relationships
- **Drag** nodes to rearrange the layout
- **Scroll** to zoom in/out
- **Search** in the top bar to filter files by name

### Example: Analyze your own project

```bash
# Point at your project's source root
node packages/server/dist/index.js init ~/my-project/src

# Or point at the entire repo (it filters to .ts/.tsx/.js/.jsx only)
node packages/server/dist/index.js init ~/my-project

# Start the server
node packages/server/dist/index.js serve
```

### Live watching

While `depgraph serve` is running, edit any file in the analyzed project. The watcher detects the change, re-parses the file, updates the graph in Kuzu, and pushes a WebSocket event to the UI — the graph re-renders automatically.

## Development

### Build individual packages

```bash
npm run build:core     # Build the parser + graph builder
npm run build:server   # Build the Express server + CLI
npm run build:ui       # Build the React frontend
```

### Run the UI in dev mode (hot reload)

```bash
npm run dev:ui
```

This starts Vite's dev server with hot module replacement. API requests are proxied to `http://localhost:3000`, so make sure `depgraph serve` is running in another terminal.

## Architecture

```
packages/core/       → Parser (ts-morph) + GraphBuilder (Kuzu queries)
packages/server/     → CLI (commander) + Express API + chokidar watcher + WebSocket
packages/ui/         → React + D3 force graph + Vite
```

**Storage** lives in `.depgraph/` at the analyzed project root:
- `graph.kuzu/` — Kuzu embedded graph database (files, imports, symbols, calls)
- `meta.sqlite` — SQLite for project config, parse errors, and watcher state

### Graph schema (Kuzu)

```
Node tables:  File, Symbol, Commit
Edge tables:  IMPORTS (File→File), CALLS (Symbol→Symbol), SNAPSHOT (Commit→File)
```

## Troubleshooting

**"No .depgraph directory found"** — Run `depgraph init <dir>` first to parse a project.

**"No TypeScript/JavaScript files found"** — Make sure you're pointing at a directory that contains `.ts`, `.tsx`, `.js`, or `.jsx` files.

**Port 3000 already in use** — Either stop the other process or use `--port 4000`.

**Native module build errors during install** — Ensure you have Python 3 and a C++ compiler available. On Ubuntu: `sudo apt install build-essential python3`. On macOS: `xcode-select --install`.
