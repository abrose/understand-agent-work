import React, { useState } from 'react';
import { ModuleGraph } from './components/ModuleGraph';
import { Sidebar } from './components/Sidebar';
import { SymbolPanel } from './components/SymbolPanel';
import { useGraph } from './hooks/useGraph';
import { useWebSocket } from './hooks/useWebSocket';

export function App() {
  const { graph, loading, error, refetch } = useGraph();
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useWebSocket(refetch);

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

  const filteredNodes = searchQuery
    ? graph.nodes.filter((n: any) =>
        (n['f.id'] || n.id || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : graph.nodes;

  const filteredNodeIds = new Set(filteredNodes.map((n: any) => n['f.id'] || n.id));
  const filteredEdges = graph.edges.filter(
    (e: any) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
  );

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
        <div style={styles.stats}>
          {graph.nodes.length} files &middot; {graph.edges.length} edges
        </div>
      </header>
      <div style={styles.main}>
        <Sidebar
          nodes={graph.nodes}
          selectedNode={selectedNode}
          onSelectNode={setSelectedNode}
        />
        <div style={styles.graphArea}>
          <ModuleGraph
            nodes={filteredNodes}
            edges={filteredEdges}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
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
    maxWidth: 400,
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
