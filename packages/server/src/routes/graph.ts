import { Router } from 'express';
import type { DBContext } from '../db.js';

export function graphRoutes(ctx: DBContext): Router {
  const router = Router();

  // GET /api/graph — full graph for initial UI load
  router.get('/', async (_req, res) => {
    try {
      const { nodes, edges } = await ctx.builder.getFullGraph();

      // Get project meta from SQLite
      const meta = ctx.sqlite
        .prepare(`SELECT * FROM project WHERE id = 'default'`)
        .get() as Record<string, unknown> | undefined;

      res.json({ nodes, edges, meta: meta ?? null });
    } catch (err) {
      console.error('Error fetching graph:', err);
      res.status(500).json({ error: 'Failed to fetch graph' });
    }
  });

  // GET /api/graph/cycles — circular dependency detection
  router.get('/cycles', async (_req, res) => {
    try {
      const { cycles } = await ctx.builder.getCycles();
      const cyclicIds = new Set<string>();
      for (const c of cycles) {
        cyclicIds.add(c.a);
        cyclicIds.add(c.b);
      }
      res.json({ cycles, cyclicFileIds: Array.from(cyclicIds) });
    } catch (err) {
      console.error('Error detecting cycles:', err);
      res.status(500).json({ error: 'Failed to detect cycles' });
    }
  });

  // GET /api/graph/file/:id — detail for a single file
  router.get('/file/*', async (req, res) => {
    try {
      const fileId = (req.params as Record<string, string>)[0]; // wildcard captures the full path
      const detail = await ctx.builder.getFileDetail(fileId);
      res.json(detail);
    } catch (err) {
      console.error('Error fetching file detail:', err);
      res.status(500).json({ error: 'Failed to fetch file detail' });
    }
  });

  // GET /api/graph/positions — load saved node positions
  router.get('/positions', (_req, res) => {
    try {
      const rows = ctx.sqlite
        .prepare(`SELECT file_id, x, y FROM node_positions`)
        .all() as Array<{ file_id: string; x: number; y: number }>;
      const positions: Record<string, { x: number; y: number }> = {};
      for (const row of rows) {
        positions[row.file_id] = { x: row.x, y: row.y };
      }
      res.json({ positions });
    } catch (err) {
      console.error('Error loading positions:', err);
      res.status(500).json({ error: 'Failed to load positions' });
    }
  });

  // POST /api/graph/positions — save node positions
  router.post('/positions', (req, res) => {
    try {
      const { positions } = req.body as {
        positions: Record<string, { x: number; y: number }>;
      };
      if (!positions) {
        res.status(400).json({ error: 'Missing positions field' });
        return;
      }
      const stmt = ctx.sqlite.prepare(
        `INSERT OR REPLACE INTO node_positions (file_id, x, y) VALUES (?, ?, ?)`
      );
      const insertMany = ctx.sqlite.transaction(
        (entries: Array<[string, number, number]>) => {
          for (const [fileId, x, y] of entries) {
            stmt.run(fileId, x, y);
          }
        }
      );
      const entries = Object.entries(positions).map(
        ([id, pos]) => [id, pos.x, pos.y] as [string, number, number]
      );
      insertMany(entries);
      res.json({ saved: entries.length });
    } catch (err) {
      console.error('Error saving positions:', err);
      res.status(500).json({ error: 'Failed to save positions' });
    }
  });

  return router;
}
