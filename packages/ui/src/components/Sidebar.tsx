import React, { useMemo } from 'react';

interface Filters {
  directory: string | null;
  minInDegree: number;
  cycleOnly: boolean;
}

interface Props {
  nodes: any[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  directories: string[];
  cyclicFileIds: Set<string>;
  cycleCount: number;
  edgeCount: number;
}

export function Sidebar({
  nodes,
  selectedNode,
  onSelectNode,
  filters,
  onFiltersChange,
  directories,
  cyclicFileIds,
  cycleCount,
  edgeCount,
}: Props) {
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
      <div style={styles.section}>
        <h3 style={styles.heading}>Stats</h3>
        <div style={styles.statsRow}>{nodes.length} files</div>
        <div style={styles.statsRow}>{edgeCount} edges</div>
        {cycleCount > 0 && (
          <div style={{ ...styles.statsRow, color: '#f85149' }}>
            {cycleCount} in cycles
          </div>
        )}
      </div>

      <div style={styles.section}>
        <h3 style={styles.heading}>Filters</h3>

        <label style={styles.filterLabel}>Directory</label>
        <select
          value={filters.directory ?? ''}
          onChange={(e) =>
            onFiltersChange({ ...filters, directory: e.target.value || null })
          }
          style={styles.select}
        >
          <option value="">All directories</option>
          {directories.map((d) => (
            <option key={d} value={d}>
              {d}/
            </option>
          ))}
        </select>

        <label style={styles.filterLabel}>Min in-degree</label>
        <input
          type="range"
          min={0}
          max={20}
          value={filters.minInDegree}
          onChange={(e) =>
            onFiltersChange({ ...filters, minInDegree: parseInt(e.target.value, 10) })
          }
          style={styles.range}
        />
        <div style={styles.rangeValue}>{filters.minInDegree}</div>

        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={filters.cycleOnly}
            onChange={(e) =>
              onFiltersChange({ ...filters, cycleOnly: e.target.checked })
            }
          />
          <span style={{ marginLeft: 6 }}>Cycles only</span>
        </label>
      </div>

      <div style={styles.section}>
        <h3 style={styles.heading}>Files</h3>
      </div>
      <div style={styles.list}>
        {dirs.map(([dir, files]) => (
          <div key={dir}>
            <div style={styles.dirLabel}>{dir}/</div>
            {files.map((f: any) => {
              const id = f['f.id'] || f.id;
              const label = f['f.label'] || f.label || id;
              const isSelected = id === selectedNode;
              const isCyclic = cyclicFileIds.has(id);
              return (
                <div
                  key={id}
                  style={{
                    ...styles.fileItem,
                    background: isSelected ? '#1f6feb33' : 'transparent',
                    color: isCyclic ? '#f85149' : isSelected ? '#58a6ff' : '#c9d1d9',
                  }}
                  onClick={() => onSelectNode(isSelected ? null : id)}
                >
                  {isCyclic && <span style={styles.cycleBadge} title="Part of a circular import">&#x21BB;</span>}
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
    width: 240,
    borderRight: '1px solid #30363d',
    background: '#161b22',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  section: {
    padding: '8px 12px',
    borderBottom: '1px solid #30363d',
  },
  heading: {
    fontSize: 11,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  statsRow: {
    fontSize: 12,
    color: '#8b949e',
    padding: '1px 0',
  },
  filterLabel: {
    display: 'block',
    fontSize: 11,
    color: '#8b949e',
    marginTop: 6,
    marginBottom: 3,
  },
  select: {
    width: '100%',
    padding: '4px 6px',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#c9d1d9',
    fontSize: 12,
  },
  range: {
    width: '100%',
    accentColor: '#58a6ff',
  },
  rangeValue: {
    fontSize: 11,
    color: '#8b949e',
    textAlign: 'right' as const,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    color: '#c9d1d9',
    marginTop: 8,
    cursor: 'pointer',
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
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  cycleBadge: {
    fontSize: 12,
    color: '#f85149',
    flexShrink: 0,
  },
};
