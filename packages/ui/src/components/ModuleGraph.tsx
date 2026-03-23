import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface Props {
  nodes: any[];
  edges: any[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}

// Color scale based on directory
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

export function ModuleGraph({ nodes, edges, selectedNode, onSelectNode }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Compute in-degree for node sizing
    const inDegree: Record<string, number> = {};
    edges.forEach((e: any) => {
      const target = e.target || e['b.id'];
      inDegree[target] = (inDegree[target] || 0) + 1;
    });

    // Map nodes
    const graphNodes = nodes.map((n: any) => {
      const id = n['f.id'] || n.id;
      const dir = n['f.dir'] || n.dir || '';
      const label = n['f.label'] || n.label || id;
      return { id, dir, label, inDegree: inDegree[id] || 0 };
    });

    const nodeIds = new Set(graphNodes.map((n) => n.id));

    // Map edges, filtering to only existing nodes
    const graphEdges = edges
      .map((e: any) => ({
        source: e.source || e['a.id'],
        target: e.target || e['b.id'],
        namedImports: e.named_imports || e['r.named_imports'] || [],
      }))
      .filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target));

    // Create zoom group
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Build simulation
    const simulation = d3.forceSimulation(graphNodes as any)
      .force('link', d3.forceLink(graphEdges).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Arrow marker
    svg.append('defs').append('marker')
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
      .attr('stroke', (d: any) => d.id === selectedNode ? '#fff' : 'transparent')
      .attr('stroke-width', 2)
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
            d.fx = null;
            d.fy = null;
          }) as any
      );

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

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, selectedNode, onSelectNode]);

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%', background: '#0d1117' }}
    />
  );
}
