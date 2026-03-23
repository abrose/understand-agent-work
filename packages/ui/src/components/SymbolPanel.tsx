import React, { useEffect, useState } from 'react';

interface Props {
  fileId: string;
  onClose: () => void;
}

interface FileDetail {
  file: any;
  imports: any[];
  importedBy: any[];
  symbols: any[];
  calls: any[];
}

export function SymbolPanel({ fileId, onClose }: Props) {
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/graph/file/${encodeURIComponent(fileId)}`)
      .then((res) => res.json())
      .then((data) => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [fileId]);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>{fileId}</h3>
        <button onClick={onClose} style={styles.closeBtn}>
          &times;
        </button>
      </div>
      {loading ? (
        <div style={styles.content}>Loading...</div>
      ) : detail ? (
        <div style={styles.content}>
          {detail.symbols.length > 0 && (
            <section>
              <h4 style={styles.sectionTitle}>Symbols</h4>
              {detail.symbols.map((s: any) => (
                <div key={s['s.id'] || s.id} style={styles.item}>
                  <span style={styles.kind}>{s['s.kind'] || s.kind}</span>
                  {s['s.name'] || s.name}
                </div>
              ))}
            </section>
          )}
          {detail.imports.length > 0 && (
            <section>
              <h4 style={styles.sectionTitle}>Imports</h4>
              {detail.imports.map((f: any) => (
                <div key={f['b.id'] || f.id} style={styles.item}>
                  {f['b.id'] || f.id}
                </div>
              ))}
            </section>
          )}
          {detail.importedBy.length > 0 && (
            <section>
              <h4 style={styles.sectionTitle}>Imported By</h4>
              {detail.importedBy.map((f: any) => (
                <div key={f['a.id'] || f.id} style={styles.item}>
                  {f['a.id'] || f.id}
                </div>
              ))}
            </section>
          )}
          {detail.calls.length > 0 && (
            <section>
              <h4 style={styles.sectionTitle}>Calls</h4>
              {detail.calls.map((c: any, i: number) => (
                <div key={i} style={styles.item}>
                  {c.source || c['a.id']} &rarr; {c.target || c['b.id']}
                </div>
              ))}
            </section>
          )}
        </div>
      ) : (
        <div style={styles.content}>No data available.</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    right: 0,
    top: 0,
    bottom: 0,
    width: 360,
    background: '#161b22',
    borderLeft: '1px solid #30363d',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 100,
    boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #30363d',
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#58a6ff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    fontSize: 20,
    cursor: 'pointer',
    padding: '0 4px',
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
  },
  item: {
    fontSize: 13,
    padding: '3px 0',
    color: '#c9d1d9',
  },
  kind: {
    display: 'inline-block',
    background: '#30363d',
    color: '#8b949e',
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 11,
    marginRight: 6,
  },
};
