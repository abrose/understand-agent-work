import React, { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';

interface Props {
  nodes: any[];
  edges: any[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  cyclicFileIds: Set<string>;
}

function dirColor(dir: string): string {
  const colors = [
    '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff',
    '#79c0ff', '#56d364', '#e3b341', '#ff7b72', '#d2a8ff',
  ];
  let hash = 0;
  for (let i = 0; i < dir.length; i++) {
    hash = (hash * 31 + dir.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

// Debounced position saver
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function savePositions(positions: Record<string, { x: number; y: number }>) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    fetch('/api/graph/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions }),
    }).catch(() => {});
  }, 1000);
}

export function ModuleGraph({ nodes, edges, selectedNode, onSelectNode, cyclicFileIds }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // Load saved positions once
  useEffect(() => {
    fetch('/api/graph/positions')
      .then((res) => res.json())
      .then((data) => {
        positionsRef.current = data.positions || {};
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Compute in-degree
    const inDegree: Record<string, number> = {};
    edges.forEach((e: any) => {
      const target = e.target || e['b.id'];
      inDegree[target] = (inDegree[target] || 0) + 1;
    });

    // Map nodes, applying saved positions
    const savedPos = positionsRef.current;
    const graphNodes = nodes.map((n: any) => {
      const id = n['f.id'] || n.id;
      const dir = n['f.dir'] || n.dir || '';
      const label = n['f.label'] || n.label || id;
      const saved = savedPos[id];
      return {
        id,
        dir,
        label,
        inDegree: inDegree[id] || 0,
        isCyclic: cyclicFileIds.has(id),
        x: saved?.x ?? undefined,
        y: saved?.y ?? undefined,
        fx: saved ? saved.x : undefined,
        fy: saved ? saved.y : undefined,
      };
    });

    const nodeIds = new Set(graphNodes.map((n) => n.id));

    const graphEdges = edges
      .map((e: any) => ({
        source: e.source || e['a.id'],
        target: e.target || e['b.id'],
        namedImports: e.named_imports || e['r.named_imports'] || [],
      }))
      .filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target));

    // Zoom
    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    // Simulation
    const simulation = d3.forceSimulation(graphNodes as any)
      .force('link', d3.forceLink(graphEdges).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Arrow marker
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#30363d');

    // Edges
    const link = g.append('g')
      .selectAll('line')
      .data(graphEdges)
      .join('line')
      .attr('stroke', '#30363d')
      .attr('stroke-width', (d: any) => Math.max(1, Math.min(4, (d.namedImports?.length || 1))))
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', 'url(#arrowhead)');

    // Nodes
    const node = g.append('g')
      .selectAll('circle')
      .data(graphNodes)
      .join('circle')
      .attr('r', (d: any) => 6 + Math.min(d.inDegree * 2, 16))
      .attr('fill', (d: any) => dirColor(d.dir))
      .attr('stroke', (d: any) => {
        if (d.id === selectedNode) return '#fff';
        if (d.isCyclic) return '#f85149';
        return 'transparent';
      })
      .attr('stroke-width', (d: any) => (d.isCyclic ? 2.5 : 2))
      .attr('stroke-dasharray', (d: any) => (d.isCyclic && d.id !== selectedNode ? '4 2' : 'none'))
      .attr('cursor', 'pointer')
      .on('click', (_event: any, d: any) => {
        onSelectNode(d.id === selectedNode ? null : d.id);
      })
      .call(
        d3.drag<SVGCircleElement, any>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            // Keep the position fixed (persisted)
            d.fx = event.x;
            d.fy = event.y;
            // Save position
            positionsRef.current[d.id] = { x: event.x, y: event.y };
            savePositions(positionsRef.current);
          }) as any
      );

    // Enter transition: grow in
    node
      .attr('r', 0)
      .transition()
      .duration(400)
      .attr('r', (d: any) => 6 + Math.min(d.inDegree * 2, 16));

    link
      .attr('stroke-opacity', 0)
      .transition()
      .duration(400)
      .attr('stroke-opacity', 0.6);

    // Labels
    const label = g.append('g')
      .selectAll('text')
      .data(graphNodes)
      .join('text')
      .attr('font-size', 11)
      .attr('fill', '#8b949e')
      .attr('dx', 12)
      .attr('dy', 4)
      .text((d: any) => d.label);

    // Tooltips
    node.append('title').text((d: any) => d.id);

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);

      label
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);
    });

    // Release fixed positions after initial layout settles (except user-pinned)
    setTimeout(() => {
      graphNodes.forEach((n: any) => {
        if (!savedPos[n.id]) {
          n.fx = null;
          n.fy = null;
        }
      });
      simulation.alpha(0.1).restart();
    }, 2000);

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, selectedNode, onSelectNode, cyclicFileIds]);

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%', background: '#0d1117' }}
    />
  );
}
