import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ModuleGraph } from './components/ModuleGraph';
import { Sidebar } from './components/Sidebar';
import { SymbolPanel } from './components/SymbolPanel';
import { TimelineSlider } from './components/TimelineSlider';
import { useGraph } from './hooks/useGraph';
import { useHistory } from './hooks/useHistory';
import { useWebSocket } from './hooks/useWebSocket';

interface Filters {
  directory: string | null;
  minInDegree: number;
  cycleOnly: boolean;
}

export function App() {
  const { graph, loading, error, refetch } = useGraph();
  const { commits, loading: historyLoading, fetchSnapshot } = useHistory();
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<Filters>({
    directory: null,
    minInDegree: 0,
    cycleOnly: false,
  });
  const [cyclicFileIds, setCyclicFileIds] = useState<Set<string>>(new Set());
  const [timelineIndex, setTimelineIndex] = useState(-1); // -1 = current
  const [timelineGraph, setTimelineGraph] = useState<{ nodes: any[]; edges: any[] } | null>(null);

  useWebSocket(refetch);

  // Fetch cycles
  useEffect(() => {
    fetch('/api/graph/cycles')
      .then((res) => res.json())
      .then((data) => setCyclicFileIds(new Set(data.cyclicFileIds || [])))
      .catch(() => {});
  }, [graph]);

  // Handle timeline changes
  const handleTimelineChange = useCallback(
    async (index: number) => {
      setTimelineIndex(index);
      if (index === -1 || index >= commits.length) {
        setTimelineGraph(null);
        return;
      }
      const snapshot = await fetchSnapshot(commits[index].hash);
      setTimelineGraph(snapshot);
    },
    [commits, fetchSnapshot]
  );

  // Active graph (current or timeline snapshot)
  const activeGraph = timelineGraph ?? graph;

  // Compute in-degree for filtering
  const inDegree = useMemo(() => {
    const deg: Record<string, number> = {};
    activeGraph.edges.forEach((e: any) => {
      const target = e.target || e['b.id'];
      deg[target] = (deg[target] || 0) + 1;
    });
    return deg;
  }, [activeGraph.edges]);

  // Unique directories for filter dropdown
  const directories = useMemo(() => {
    const dirs = new Set<string>();
    activeGraph.nodes.forEach((n: any) => {
      const dir = n['f.dir'] || n.dir || '.';
      dirs.add(dir);
    });
    return Array.from(dirs).sort();
  }, [activeGraph.nodes]);

  // Apply all filters
  const filteredNodes = useMemo(() => {
    return activeGraph.nodes.filter((n: any) => {
      const id = n['f.id'] || n.id || '';
      const dir = n['f.dir'] || n.dir || '.';

      // Search filter
      if (searchQuery && !id.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      // Directory filter
      if (filters.directory && dir !== filters.directory) {
        return false;
      }
      // In-degree filter
      if (filters.minInDegree > 0 && (inDegree[id] || 0) < filters.minInDegree) {
        return false;
      }
      // Cycle-only filter
      if (filters.cycleOnly && !cyclicFileIds.has(id)) {
        return false;
      }
      return true;
    });
  }, [activeGraph.nodes, searchQuery, filters, inDegree, cyclicFileIds]);

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n: any) => n['f.id'] || n.id)),
    [filteredNodes]
  );
  const filteredEdges = useMemo(
    () =>
      activeGraph.edges.filter(
        (e: any) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
      ),
    [activeGraph.edges, filteredNodeIds]
  );

  if (loading) {
    return (
      <div style={styles.loading}>
        <h2>depgraph</h2>
        <p>Loading graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.loading}>
        <h2>depgraph</h2>
        <p style={{ color: '#f85149' }}>Error: {error}</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>depgraph</h1>
        <input
          type="text"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.search}
        />
        {commits.length > 0 && (
          <TimelineSlider
            commits={commits}
            selectedIndex={timelineIndex === -1 ? commits.length - 1 : timelineIndex}
            onChange={(idx) => handleTimelineChange(idx === commits.length - 1 ? -1 : idx)}
          />
        )}
        <div style={styles.stats}>
          {filteredNodes.length}/{activeGraph.nodes.length} files &middot;{' '}
          {filteredEdges.length} edges
          {cyclicFileIds.size > 0 && (
            <span style={{ color: '#f85149' }}>
              {' '}
              &middot; {cyclicFileIds.size} in cycles
            </span>
          )}
        </div>
      </header>
      <div style={styles.main}>
        <Sidebar
          nodes={activeGraph.nodes}
          selectedNode={selectedNode}
          onSelectNode={setSelectedNode}
          filters={filters}
          onFiltersChange={setFilters}
          directories={directories}
          cyclicFileIds={cyclicFileIds}
          cycleCount={cyclicFileIds.size}
          edgeCount={activeGraph.edges.length}
        />
        <div style={styles.graphArea}>
          <ModuleGraph
            nodes={filteredNodes}
            edges={filteredEdges}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            cyclicFileIds={cyclicFileIds}
          />
        </div>
      </div>
      {selectedNode && (
        <SymbolPanel
          fileId={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '8px 16px',
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    flexShrink: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: '#58a6ff',
  },
  search: {
    flex: 1,
    maxWidth: 300,
    padding: '6px 12px',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#e1e4e8',
    fontSize: 14,
    outline: 'none',
  },
  stats: {
    fontSize: 13,
    color: '#8b949e',
    marginLeft: 'auto',
    whiteSpace: 'nowrap' as const,
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  graphArea: {
    flex: 1,
    position: 'relative' as const,
  },
  loading: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: 8,
  },
};
