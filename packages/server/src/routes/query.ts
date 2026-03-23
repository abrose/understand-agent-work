import { Router } from 'express';
import type { DBContext } from '../db.js';

export function queryRoutes(ctx: DBContext): Router {
  const router = Router();

  // POST /api/query — run raw Cypher query
  router.post('/', async (req, res) => {
    try {
      const { cypher } = req.body;
      if (!cypher || typeof cypher !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "cypher" field' });
        return;
      }

      const { rows } = await ctx.builder.runQuery(cypher);
      res.json({ rows });
    } catch (err) {
      console.error('Query error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
