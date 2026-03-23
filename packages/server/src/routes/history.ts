import { Router } from 'express';
import type { DBContext } from '../db.js';

export function historyRoutes(ctx: DBContext): Router {
  const router = Router();

  // GET /api/history — list stored commits
  router.get('/', async (_req, res) => {
    try {
      const result = await ctx.builder.runQuery(
        `MATCH (c:Commit) RETURN c.* ORDER BY c.date DESC`
      );
      res.json({ commits: result.rows });
    } catch (err) {
      console.error('Error fetching history:', err);
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  });

  // GET /api/history/:hash — graph state at a specific commit
  router.get('/:hash', async (req, res) => {
    try {
      const { hash } = req.params;

      const nodesResult = await ctx.builder.runQuery(
        `MATCH (c:Commit {hash: "${hash}"})-[:SNAPSHOT]->(f:File) RETURN f.*`
      );

      const edgesResult = await ctx.builder.runQuery(
        `MATCH (c:Commit {hash: "${hash}"})-[:SNAPSHOT]->(f:File)-[r:IMPORTS]->(g:File)<-[:SNAPSHOT]-(c)
         RETURN f.id AS source, g.id AS target, r.named_imports AS named_imports, r.line AS line`
      );

      res.json({ nodes: nodesResult.rows, edges: edgesResult.rows });
    } catch (err) {
      console.error('Error fetching history snapshot:', err);
      res.status(500).json({ error: 'Failed to fetch history snapshot' });
    }
  });

  return router;
}
