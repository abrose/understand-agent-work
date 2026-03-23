# depgraph

A local dev tool that builds a persistent graph database of a TypeScript/JavaScript codebase. It parses imports and symbols using `ts-morph`, stores them in an embedded Kuzu graph database, and serves an interactive D3 force-directed visualization at `localhost:3000`.

## Prerequisites

- **Docker** and **Docker Compose** (recommended)
- Or: **Node.js 22+**, **pnpm 10+**, Python 3, and a C++ toolchain for native modules

## Installation

### Docker (recommended)

```bash
git clone <repo-url> depgraph
cd depgraph
docker compose build
```

### Local (requires matching Node.js version for native modules)

```bash
git clone <repo-url> depgraph
cd depgraph
pnpm install
pnpm run build
```

This builds all three packages:

| Package | Description |
|---------|-------------|
| `@depgraph/core` | ts-morph parser + Kuzu graph builder |
| `@depgraph/server` | Express API, CLI entry point, file watcher |
| `@depgraph/ui` | React + D3 frontend (built by Vite) |

## Quick Start

### Docker

```bash
# Analyze a project
PROJECT_DIR=/path/to/your-project docker compose run depgraph init /workspace/src

# Start the server (UI at http://localhost:3000)
PROJECT_DIR=/path/to/your-project docker compose up
```

The `PROJECT_DIR` environment variable tells Docker which project directory to mount at `/workspace` inside the container. All commands that reference project paths should use `/workspace` as the root.

### Local

```bash
# Analyze a project
node packages/server/dist/index.js init /path/to/your-project/src

# Start the server
node packages/server/dist/index.js serve
```

### What happens during init

- Recursively finds all `.ts`, `.tsx`, `.js`, and `.jsx` files
- Parses imports and symbols from each file using ts-morph
- Stores the file-level and symbol-level graph in Kuzu (`.depgraph/graph.kuzu/`)
- Stores project metadata in SQLite (`.depgraph/meta.sqlite`)

The `.depgraph/` directory is created inside the target project's root.

### What happens during serve

- An Express API on `http://localhost:3000`
- A file watcher (chokidar) that incrementally updates the graph on code changes
- A WebSocket server that pushes live updates to the UI

Open **http://localhost:3000** in your browser to see the interactive graph.

#### Custom port

```bash
# Docker
PROJECT_DIR=/path/to/your-project docker compose run -p 4000:4000 depgraph serve --port 4000

# Local
node packages/server/dist/index.js serve --port 4000
```

### Query the graph from the terminal

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

### Backfill git history

Snapshot the dependency graph at past commits to see how it evolved:

```bash
# Process the last 20 commits
node packages/server/dist/index.js history --n 20
```

Once backfilled, use the timeline slider in the UI header to scrub through commits and see the graph at each point in time.

### Watch without the UI

Run the file watcher headlessly (no HTTP server or UI):

```bash
node packages/server/dist/index.js watch
```

### Reset and re-parse

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
| `watch` | Watch for file changes and update the graph (no UI server) |
| `history` | Backfill git history snapshots (`--n` for commit count, default 10) |
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

### `GET /api/graph/cycles`

Detects circular dependencies (mutual imports) and returns the cycle pairs and all affected file IDs.

```json
{
  "cycles": [
    { "a": "src/foo.ts", "b": "src/bar.ts" }
  ],
  "cyclicFileIds": ["src/foo.ts", "src/bar.ts"]
}
```

### `GET /api/graph/positions`

Returns saved node positions for layout persistence.

```json
{
  "positions": {
    "src/index.ts": { "x": 420.5, "y": 280.3 }
  }
}
```

### `POST /api/graph/positions`

Saves node positions. The UI calls this automatically when nodes are dragged.

```json
{
  "positions": {
    "src/index.ts": { "x": 420.5, "y": 280.3 }
  }
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

Returns stored git commit snapshots (populated by `depgraph history`).

### `GET /api/history/:hash`

Returns the graph state at a specific commit.

## Testing on a Real Codebase

Here's a step-by-step walkthrough using a real open source project.

### Example: Analyze Express.js itself

#### Docker

```bash
git clone https://github.com/expressjs/express.git /tmp/express-test
PROJECT_DIR=/tmp/express-test docker compose run depgraph init /workspace
PROJECT_DIR=/tmp/express-test docker compose up
```

#### Local

```bash
git clone https://github.com/expressjs/express.git /tmp/express-test
cd /path/to/depgraph
pnpm install && pnpm run build
node packages/server/dist/index.js init /tmp/express-test
node packages/server/dist/index.js serve
```

Open http://localhost:3000 — you'll see the module graph rendered as an interactive force-directed layout.

### What to look for in the UI

- **Node size** reflects how many files import it (in-degree)
- **Node color** groups files by directory (all `lib/` files share a hue)
- **Red dashed border** flags files involved in circular imports
- **Click** a node to open the symbol panel, showing functions/classes and their call relationships
- **Drag** nodes to rearrange the layout — positions are persisted across sessions
- **Scroll** to zoom in/out
- **Search** in the top bar to filter files by name
- **Sidebar filters** let you narrow the view by directory, minimum in-degree, or cycle-only
- **Timeline slider** (visible after running `depgraph history`) scrubs through git history

### Example: Analyze your own project

#### Docker

```bash
PROJECT_DIR=~/my-project docker compose run depgraph init /workspace/src
PROJECT_DIR=~/my-project docker compose up
```

#### Local

```bash
node packages/server/dist/index.js init ~/my-project/src
node packages/server/dist/index.js serve
```

### Live watching

While `depgraph serve` is running, edit any file in the analyzed project. The watcher detects the change, re-parses the file, updates the graph in Kuzu, and pushes a WebSocket event to the UI — the graph re-renders automatically.

## Development

### Build individual packages

```bash
pnpm run build:core     # Build the parser + graph builder
pnpm run build:server   # Build the Express server + CLI
pnpm run build:ui       # Build the React frontend
```

### Run the UI in dev mode (hot reload)

```bash
pnpm run dev:ui
```

This starts Vite's dev server with hot module replacement. API requests are proxied to `http://localhost:3000`, so make sure `depgraph serve` is running in another terminal.

## Architecture

```
packages/core/       → Parser (ts-morph) + GraphBuilder (Kuzu queries) + HistoryBuilder (simple-git)
packages/server/     → CLI (commander) + Express API + chokidar watcher + WebSocket
packages/ui/         → React + D3 force graph + Vite
```

**Storage** lives in `.depgraph/` at the analyzed project root:
- `graph.kuzu/` — Kuzu embedded graph database (files, imports, symbols, calls, commits)
- `meta.sqlite` — SQLite for project config, parse errors, watcher state, and node positions

### Graph schema (Kuzu)

```
Node tables:  File, Symbol, Commit
Edge tables:  IMPORTS (File→File), CALLS (Symbol→Symbol), SNAPSHOT (Commit→File)
```

## Troubleshooting

**"No .depgraph directory found"** — Run `depgraph init <dir>` first to parse a project.

**"No TypeScript/JavaScript files found"** — Make sure you're pointing at a directory that contains `.ts`, `.tsx`, `.js`, or `.jsx` files.

**Port 3000 already in use** — Either stop the other process or use `--port 4000`.

**Native module build errors during install (local only)** — Ensure you have Python 3 and a C++ compiler available. On Ubuntu: `sudo apt install build-essential python3`. On macOS: `xcode-select --install`. Using Docker avoids this entirely.

**NODE_MODULE_VERSION mismatch** — The native modules (`better-sqlite3`, `kuzu`) were compiled for a different Node.js version. Either use Docker (recommended) or run `pnpm rebuild` after switching Node versions.
