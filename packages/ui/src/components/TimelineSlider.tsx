import React from 'react';

interface Commit {
  hash: string;
  message: string;
  date: string;
}

interface Props {
  commits: Commit[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

export function TimelineSlider({ commits, selectedIndex, onChange }: Props) {
  if (commits.length === 0) return null;

  return (
    <div style={styles.container}>
      <span style={styles.label}>Timeline</span>
      <input
        type="range"
        min={0}
        max={commits.length - 1}
        value={selectedIndex}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={styles.slider}
        title={commits[selectedIndex]?.message || ''}
      />
      <span style={styles.label}>Now</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 12,
    color: '#8b949e',
  },
  slider: {
    width: 200,
    accentColor: '#58a6ff',
  },
};
