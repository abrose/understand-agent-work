import chokidar from 'chokidar';
import * as path from 'path';
import { Parser } from '@depgraph/core';
import type { DBContext } from './db.js';
import { broadcastGraphUpdate } from './ws.js';

export function startWatcher(rootDir: string, ctx: DBContext): chokidar.FSWatcher {
  const parser = new Parser(rootDir);
  const glob = path.join(rootDir, '**/*.{ts,tsx,js,jsx}');

  const watcher = chokidar.watch(glob, {
    ignored: [
      /node_modules/,
      /\.depgraph/,
      /dist/,
    ],
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', async (filePath) => {
    console.log(`[watcher] File changed: ${filePath}`);
    const relPath = path.relative(rootDir, filePath);
    try {
      await ctx.builder.removeFile(relPath);
      const parsed = parser.parseFile(filePath);
      await ctx.builder.insertFile(parsed);
      broadcastGraphUpdate();
      console.log(`[watcher] Updated graph for: ${relPath}`);
    } catch (err) {
      console.error(`[watcher] Error updating ${relPath}:`, err);
    }
  });

  watcher.on('add', async (filePath) => {
    console.log(`[watcher] File added: ${filePath}`);
    const relPath = path.relative(rootDir, filePath);
    try {
      const parsed = parser.parseFile(filePath);
      await ctx.builder.insertFile(parsed);
      broadcastGraphUpdate();
      console.log(`[watcher] Added to graph: ${relPath}`);
    } catch (err) {
      console.error(`[watcher] Error adding ${relPath}:`, err);
    }
  });

  watcher.on('unlink', async (filePath) => {
    console.log(`[watcher] File removed: ${filePath}`);
    const relPath = path.relative(rootDir, filePath);
    try {
      await ctx.builder.removeFile(relPath);
      broadcastGraphUpdate();
      console.log(`[watcher] Removed from graph: ${relPath}`);
    } catch (err) {
      console.error(`[watcher] Error removing ${relPath}:`, err);
    }
  });

  console.log(`[watcher] Watching ${rootDir} for changes`);
  return watcher;
}
