import { useState, useEffect } from 'react';

interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export function useHistory() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/history')
      .then((res) => res.json())
      .then((data) => setCommits(data.commits || []))
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, []);

  const fetchSnapshot = async (hash: string) => {
    const res = await fetch(`/api/history/${hash}`);
    return res.json();
  };

  return { commits, loading, fetchSnapshot };
}
