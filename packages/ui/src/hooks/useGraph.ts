import { useState, useEffect, useCallback } from 'react';

interface GraphData {
  nodes: any[];
  edges: any[];
  meta: any;
}

export function useGraph() {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [], meta: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch('/api/graph');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGraph(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch graph');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  return { graph, loading, error, refetch: fetchGraph };
}
