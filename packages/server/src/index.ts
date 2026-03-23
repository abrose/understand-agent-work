#!/usr/bin/env node

import { Command } from 'commander';
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { Parser, HistoryBuilder } from '@depgraph/core';
import { simpleGit } from 'simple-git';
import { initDB, saveProjectMeta, updateLastParsed, logParseError } from './db.js';
import { graphRoutes } from './routes/graph.js';
import { queryRoutes } from './routes/query.js';
import { historyRoutes } from './routes/history.js';
import { setupWebSocket } from './ws.js';
import { startWatcher } from './watcher.js';
import type { DBContext } from './db.js';

const program = new Command();

program
  .name('depgraph')
  .description('Local dev tool for visualizing TypeScript/JavaScript dependency graphs')
  .version('0.1.0');

// depgraph init <dir>
program
  .command('init <dir>')
  .description('Parse a project directory and populate the graph database')
  .action(async (dir: string) => {
    const rootDir = path.resolve(dir);

    if (!fs.existsSync(rootDir)) {
      console.error(`Directory does not exist: ${rootDir}`);
      process.exit(1);
    }

    console.log(`Initializing depgraph for: ${rootDir}`);
    const ctx = await initDB(rootDir);

    saveProjectMeta(ctx.sqlite, rootDir);

    const parser = new Parser(rootDir);
    const parsedFiles = parser.parseDirectory(rootDir);

    if (parsedFiles.length === 0) {
      console.error('No TypeScript/JavaScript files found in target directory');
      process.exit(1);
    }

    console.log(`Parsed ${parsedFiles.length} files. Inserting into graph...`);

    // Insert all file nodes first
    for (const parsed of parsedFiles) {
      try {
        await ctx.builder.insertFile(parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error inserting ${parsed.file.id}: ${msg}`);
        logParseError(ctx.sqlite, parsed.file.id, 0, msg);
      }
    }

    // Now create import edges (targets should exist now)
    for (const parsed of parsedFiles) {
      try {
        await ctx.builder.insertImportEdges(parsed.imports);
      } catch (err) {
        // Silently skip edges where target file doesn't exist in graph
      }
    }

    updateLastParsed(ctx.sqlite);
    console.log(`Done. Graph stored in ${path.join(rootDir, '.depgraph/')}`);
    process.exit(0);
  });

// depgraph serve
program
  .command('serve')
  .description('Start the background watcher + UI server')
  .option('-p, --port <port>', 'Port for the UI server', '3000')
  .action(async (opts: { port: string }) => {
    const port = parseInt(opts.port, 10);

    // Find project root by looking for .depgraph directory
    const rootDir = findProjectRoot();
    if (!rootDir) {
      console.error('No .depgraph directory found. Run "depgraph init <dir>" first.');
      process.exit(1);
    }

    console.log(`Starting depgraph server for: ${rootDir}`);
    const ctx = await initDB(rootDir);

    const app = createExpressApp(ctx);
    const server = http.createServer(app);
    setupWebSocket(server);

    // Start file watcher
    const projectMeta = ctx.sqlite
      .prepare(`SELECT root FROM project WHERE id = 'default'`)
      .get() as { root: string } | undefined;

    if (projectMeta) {
      startWatcher(projectMeta.root, ctx);
    }

    server.listen(port, () => {
      console.log(`UI available at http://localhost:${port}`);
      console.log(`Watching for changes...`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use`);
        process.exit(3);
      }
      throw err;
    });
  });

// depgraph query <cypher>
program
  .command('query <cypher>')
  .description('Run a Cypher query against the graph')
  .action(async (cypher: string) => {
    const rootDir = findProjectRoot();
    if (!rootDir) {
      console.error('No .depgraph directory found. Run "depgraph init <dir>" first.');
      process.exit(1);
    }

    const ctx = await initDB(rootDir);
    try {
      const { rows } = await ctx.builder.runQuery(cypher);
      console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
      console.error('Query error:', err);
      process.exit(2);
    }
    process.exit(0);
  });

// depgraph history
program
  .command('history')
  .description('Backfill git history (last N commits)')
  .option('-n, --n <count>', 'Number of commits to process', '10')
  .action(async (opts: { n: string }) => {
    const n = parseInt(opts.n, 10);
    const rootDir = findProjectRoot();
    if (!rootDir) {
      console.error('No .depgraph directory found. Run "depgraph init <dir>" first.');
      process.exit(1);
    }

    const ctx = await initDB(rootDir);
    const projectMeta = ctx.sqlite
      .prepare(`SELECT root FROM project WHERE id = 'default'`)
      .get() as { root: string } | undefined;

    if (!projectMeta) {
      console.error('No project metadata found. Run "depgraph init <dir>" first.');
      process.exit(1);
    }

    const git = simpleGit(projectMeta.root);
    const historyBuilder = new HistoryBuilder(ctx.builder as any, projectMeta.root);
    console.log(`Backfilling last ${n} commits...`);

    const count = await historyBuilder.backfill(git as any, n);
    console.log(`Processed ${count} commits.`);
    process.exit(0);
  });

// depgraph watch
program
  .command('watch')
  .description('Watch for file changes and update the graph (no UI server)')
  .action(async () => {
    const rootDir = findProjectRoot();
    if (!rootDir) {
      console.error('No .depgraph directory found. Run "depgraph init <dir>" first.');
      process.exit(1);
    }

    const ctx = await initDB(rootDir);
    const projectMeta = ctx.sqlite
      .prepare(`SELECT root FROM project WHERE id = 'default'`)
      .get() as { root: string } | undefined;

    if (!projectMeta) {
      console.error('No project metadata found. Run "depgraph init <dir>" first.');
      process.exit(1);
    }

    console.log(`Watching ${projectMeta.root} for changes (Ctrl+C to stop)...`);
    startWatcher(projectMeta.root, ctx);
  });

// depgraph reset
program
  .command('reset')
  .description('Wipe the database and start fresh')
  .action(async () => {
    const rootDir = findProjectRoot();
    if (!rootDir) {
      console.log('No .depgraph directory found. Nothing to reset.');
      process.exit(0);
    }

    const depgraphDir = path.join(rootDir, '.depgraph');
    fs.rmSync(depgraphDir, { recursive: true, force: true });
    console.log(`Removed ${depgraphDir}`);
    process.exit(0);
  });

// depgraph stop
program
  .command('stop')
  .description('Stop the background server')
  .action(() => {
    // In a real implementation, this would find and kill the running process
    console.log('Server stop not yet implemented (use Ctrl+C for now)');
    process.exit(0);
  });

function findProjectRoot(): string | null {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.depgraph'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function createExpressApp(ctx: DBContext): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/graph', graphRoutes(ctx));
  app.use('/api/query', queryRoutes(ctx));
  app.use('/api/history', historyRoutes(ctx));

  // Serve the UI (static files from @depgraph/ui build output)
  const uiDistPath = path.join(__dirname, '../../ui/dist');
  if (fs.existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(uiDistPath, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.send(
        '<html><body><h2>depgraph</h2><p>UI not built yet. Run <code>npm run build:ui</code> first.</p></body></html>'
      );
    });
  }

  return app;
}

program.parse();
