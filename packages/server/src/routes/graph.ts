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

  return router;
}
