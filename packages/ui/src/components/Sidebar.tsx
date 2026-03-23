import React, { useMemo } from 'react';

interface Props {
  nodes: any[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}

export function Sidebar({ nodes, selectedNode, onSelectNode }: Props) {
  const dirs = useMemo(() => {
    const dirMap: Record<string, any[]> = {};
    for (const n of nodes) {
      const dir = n['f.dir'] || n.dir || '.';
      if (!dirMap[dir]) dirMap[dir] = [];
      dirMap[dir].push(n);
    }
    return Object.entries(dirMap).sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);

  return (
    <div style={styles.sidebar}>
      <h3 style={styles.heading}>Files</h3>
      <div style={styles.stats}>
        {nodes.length} files
      </div>
      <div style={styles.list}>
        {dirs.map(([dir, files]) => (
          <div key={dir}>
            <div style={styles.dirLabel}>{dir}/</div>
            {files.map((f: any) => {
              const id = f['f.id'] || f.id;
              const label = f['f.label'] || f.label || id;
              const isSelected = id === selectedNode;
              return (
                <div
                  key={id}
                  style={{
                    ...styles.fileItem,
                    background: isSelected ? '#1f6feb33' : 'transparent',
                    color: isSelected ? '#58a6ff' : '#c9d1d9',
                  }}
                  onClick={() => onSelectNode(isSelected ? null : id)}
                >
                  {label}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 220,
    borderRight: '1px solid #30363d',
    background: '#161b22',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  heading: {
    padding: '12px 12px 4px',
    fontSize: 13,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  stats: {
    padding: '0 12px 8px',
    fontSize: 12,
    color: '#8b949e',
    borderBottom: '1px solid #30363d',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  dirLabel: {
    padding: '6px 12px 2px',
    fontSize: 11,
    fontWeight: 600,
    color: '#8b949e',
  },
  fileItem: {
    padding: '4px 12px 4px 20px',
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};
