/**
 * Interactive Visual Dependency, Community & Knowledge Graph Inspector for smart-context-packer
 * Generates an offline, zero-dependency self-contained HTML report with
 * an interactive force-directed canvas graph, Louvain community coloring, God Nodes, and token breakdown.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DependencyGraph, BlastRadiusResult, KnowledgeGraphData } from './types.js';

export interface VisualizerOptions {
  outputPath?: string;
  blastRadius?: BlastRadiusResult;
  knowledgeGraph?: KnowledgeGraphData;
  title?: string;
}

const COMMUNITY_PALETTE = [
  '#06b6d4',
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#3b82f6',
  '#eab308',
];

function extractRawEntries(graph: DependencyGraph | Record<string, any>): Array<[string, any]> {
  if (graph && 'nodes' in graph && graph.nodes instanceof Map) {
    return Array.from(graph.nodes.entries());
  }
  return Object.entries(graph as Record<string, any>).filter(
    ([key]) =>
      ![
        'targets',
        'nodes',
        'circularWarnings',
        'rootCwd',
        'missingDependencies',
        'gitDiffPatch',
        'blastRadius',
        'memories',
      ].includes(key)
  );
}

/**
 * Generates a self-contained HTML visualizer file.
 */
export function generateVisualizerHtml(
  graph: DependencyGraph | Record<string, any>,
  options?: VisualizerOptions
): string {
  const rawEntries = extractRawEntries(graph);
  const entryMap = new Map(rawEntries);
  const kg = options?.knowledgeGraph;

  // Map file paths to community IDs & God Node flags if KnowledgeGraphData is available
  const fileCommunityMap = new Map<string, { id: number; label: string }>();
  const fileGodSymbolsMap = new Map<string, string[]>();

  if (kg) {
    for (const n of kg.nodes) {
      if (n.sourceFile && n.community !== undefined && !fileCommunityMap.has(n.sourceFile)) {
        fileCommunityMap.set(n.sourceFile, {
          id: n.community,
          label: kg.communityLabels[n.community] || `Community ${n.community}`,
        });
      }
    }
    for (const g of kg.godNodes) {
      if (!fileGodSymbolsMap.has(g.sourceFile)) {
        fileGodSymbolsMap.set(g.sourceFile, []);
      }
      fileGodSymbolsMap.get(g.sourceFile)!.push(g.label);
    }
  }

  const nodes = rawEntries.map(([filePath, node], idx) => {
    const comm = fileCommunityMap.get(filePath) || {
      id: idx % COMMUNITY_PALETTE.length,
      label: path.dirname(filePath) === '.' ? 'Root' : path.dirname(filePath),
    };
    const godSyms = fileGodSymbolsMap.get(filePath) || [];
    const importsList: string[] = node.imports || node.rawImports || [];

    return {
      id: filePath,
      path: filePath,
      type: node.depth === 0 ? 'target' : 'dependency',
      depth: node.depth ?? 0,
      tokens: node.stats?.estimatedTokens || 100,
      lines: node.stats?.lines || 10,
      isSkeleton: !!node.isSkeleton,
      rawImports: importsList,
      symbols: node.exportedSymbols || [],
      communityId: comm.id,
      communityLabel: comm.label,
      color: COMMUNITY_PALETTE[comm.id % COMMUNITY_PALETTE.length],
      isGodHub: godSyms.length > 0,
      godSymbols: godSyms,
    };
  });

  const links: Array<{ source: string; target: string; confidence: string }> = [];
  for (const [source, node] of rawEntries) {
    const importsList: string[] = node.imports || node.rawImports || [];
    for (const target of importsList) {
      if (entryMap.has(target)) {
        links.push({ source, target, confidence: 'EXTRACTED' });
      }
    }
  }

  // Add cross-file INFERRED/AMBIGUOUS links from KnowledgeGraphData if present
  if (kg) {
    const nodeById = new Map(kg.nodes.map((n) => [n.id, n]));
    const seenPairs = new Set(links.map((l) => `${l.source}|${l.target}`));
    for (const edge of kg.edges) {
      if (edge.confidence === 'EXTRACTED') continue;
      const u = nodeById.get(edge.source);
      const v = nodeById.get(edge.target);
      if (u && v && u.sourceFile !== v.sourceFile && entryMap.has(u.sourceFile) && entryMap.has(v.sourceFile)) {
        const key = `${u.sourceFile}|${v.sourceFile}`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          links.push({
            source: u.sourceFile,
            target: v.sourceFile,
            confidence: edge.confidence,
          });
        }
      }
    }
  }

  const uniqueCommunities = Array.from(
    new Map(nodes.map((n) => [n.communityId, { id: n.communityId, label: n.communityLabel, color: n.color }])).values()
  );

  const blastData = options?.blastRadius || null;
  const title = options?.title || 'Smart Context Packer — Visual Knowledge Graph Inspector';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #090d16;
      --surface: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #6366f1;
      --primary-light: #818cf8;
      --accent: #06b6d4;
      --danger: #ef4444;
      --warning: #f59e0b;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 10;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }
    .badge {
      background: rgba(99, 102, 241, 0.2);
      color: var(--primary-light);
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 0.75rem;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }
    .stats {
      display: flex;
      gap: 20px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .stats strong { color: var(--text); }
    main {
      display: flex;
      flex: 1;
      position: relative;
      overflow: hidden;
    }
    #canvas-container {
      flex: 1;
      position: relative;
      background: radial-gradient(circle at 50% 50%, #111827 0%, #090d16 100%);
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
    }
    canvas:active { cursor: grabbing; }
    #sidebar {
      width: 380px;
      background: var(--surface);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 20px;
      gap: 16px;
    }
    .card {
      background: rgba(31, 41, 55, 0.5);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card h3 {
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .node-title {
      font-size: 1.1rem;
      font-weight: 600;
      word-break: break-all;
      color: var(--accent);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 10px;
      font-size: 0.85rem;
    }
    .meta-item {
      background: rgba(17, 24, 39, 0.7);
      padding: 8px;
      border-radius: 6px;
    }
    .meta-item label { color: var(--text-muted); display: block; font-size: 0.75rem; }
    .meta-item value { font-weight: 600; font-size: 0.95rem; }
    .symbols-list {
      margin-top: 8px;
      max-height: 180px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.8rem;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .symbol-pill {
      background: rgba(99, 102, 241, 0.15);
      padding: 3px 8px;
      border-radius: 4px;
      color: #c7d2fe;
      border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .legend-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .legend-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.8);
      border: 1px solid var(--border);
      cursor: pointer;
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .controls-hint {
      position: absolute;
      bottom: 16px;
      left: 16px;
      background: rgba(17, 24, 39, 0.8);
      border: 1px solid var(--border);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 0.75rem;
      color: var(--text-muted);
      backdrop-filter: blur(4px);
      pointer-events: none;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>📦 Smart Context Packer</span>
      <span class="badge">v2.5 Graphify Visualizer</span>
    </div>
    <div class="stats">
      <div>Files: <strong id="stat-files">${nodes.length}</strong></div>
      <div>Communities: <strong>${uniqueCommunities.length}</strong></div>
      <div>Total Tokens: <strong id="stat-tokens">${nodes.reduce((acc, n) => acc + n.tokens, 0).toLocaleString()}</strong></div>
      ${blastData ? `<div>Risk Level: <strong style="color: ${blastData.riskLevel === 'HIGH' ? 'var(--danger)' : blastData.riskLevel === 'MEDIUM' ? 'var(--warning)' : 'var(--success)'}">${blastData.riskLevel} (${blastData.riskScore.toFixed(1)})</strong></div>` : ''}
    </div>
  </header>
  <main>
    <div id="canvas-container">
      <canvas id="graph-canvas"></canvas>
      <div class="controls-hint">Drag nodes • Pan canvas • Scroll to zoom • Solid=EXTRACTED, Dashed=INFERRED • Gold ring=God Hub</div>
    </div>
    <div id="sidebar">
      <div class="card">
        <h3>Communities (Click to Filter)</h3>
        <div class="legend-list" id="community-legend"></div>
      </div>

      <div class="card" id="details-card">
        <h3>Selected Module Details</h3>
        <div class="node-title" id="selected-path">Click any node in graph</div>
        <div class="meta-grid">
          <div class="meta-item"><label>Tokens</label><value id="selected-tokens">-</value></div>
          <div class="meta-item"><label>Lines</label><value id="selected-lines">-</value></div>
          <div class="meta-item"><label>Community</label><value id="selected-community">-</value></div>
          <div class="meta-item"><label>Skeleton</label><value id="selected-skeleton">-</value></div>
        </div>
        <div style="margin-top: 14px;">
          <h3 style="margin-bottom: 4px;">Exported Symbols</h3>
          <div class="symbols-list" id="selected-symbols">
            <span style="color: var(--text-muted);">None</span>
          </div>
        </div>
      </div>

      ${blastData ? `
      <div class="card">
        <h3>💥 Blast-Radius Summary</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px;">${blastData.summary}</p>
        <div class="meta-grid">
          <div class="meta-item"><label>Impacted Callers</label><value>${blastData.fanInCallers?.length || blastData.callers?.length || 0}</value></div>
          <div class="meta-item"><label>Impacted Tests</label><value>${blastData.impactedTests?.length || 0}</value></div>
        </div>
      </div>` : ''}
    </div>
  </main>

  <script>
    const graphData = {
      nodes: ${JSON.stringify(nodes)},
      links: ${JSON.stringify(links)},
      communities: ${JSON.stringify(uniqueCommunities)}
    };

    let activeCommunityFilter = null;
    const legendContainer = document.getElementById('community-legend');
    const allPill = document.createElement('div');
    allPill.className = 'legend-pill';
    allPill.innerHTML = '<span>All (' + graphData.nodes.length + ')</span>';
    allPill.onclick = () => { activeCommunityFilter = null; };
    legendContainer.appendChild(allPill);

    graphData.communities.forEach(c => {
      const pill = document.createElement('div');
      pill.className = 'legend-pill';
      pill.innerHTML = '<span class="legend-dot" style="background:' + c.color + '"></span><span>' + c.label + '</span>';
      pill.onclick = () => {
        activeCommunityFilter = activeCommunityFilter === c.id ? null : c.id;
      };
      legendContainer.appendChild(pill);
    });

    const canvas = document.getElementById('graph-canvas');
    const ctx = canvas.getContext('2d');
    let width, height;

    function resize() {
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    window.addEventListener('resize', resize);
    resize();

    // Initialize node positions in a circle
    const N = graphData.nodes.length;
    graphData.nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, N)) * 2 * Math.PI;
      const r = Math.min(width, height) * 0.35;
      n.x = width / 2 + r * Math.cos(angle);
      n.y = height / 2 + r * Math.sin(angle);
      n.vx = 0;
      n.vy = 0;
      n.radius = Math.max(14, Math.min(36, Math.sqrt(n.tokens) * 0.8));
    });

    let transform = { x: 0, y: 0, k: 1 };
    let draggedNode = null;
    let selectedNode = graphData.nodes[0] || null;

    function renderDetails(n) {
      if (!n) return;
      document.getElementById('selected-path').innerText = n.path;
      document.getElementById('selected-tokens').innerText = n.tokens.toLocaleString();
      document.getElementById('selected-lines').innerText = n.lines.toLocaleString();
      document.getElementById('selected-community').innerText = n.communityLabel || n.type.toUpperCase();
      document.getElementById('selected-skeleton').innerText = n.isSkeleton ? 'YES' : 'NO';

      const symContainer = document.getElementById('selected-symbols');
      if (n.symbols && n.symbols.length > 0) {
        symContainer.innerHTML = n.symbols.map(s => '<span class="symbol-pill">' + s + '</span>').join('');
      } else {
        symContainer.innerHTML = '<span style="color: var(--text-muted);">No public symbols</span>';
      }
    }
    if (selectedNode) renderDetails(selectedNode);

    function stepSimulation() {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = graphData.nodes[i];
          const b = graphData.nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 1800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      graphData.links.forEach(link => {
        const a = graphData.nodes.find(n => n.id === link.source);
        const b = graphData.nodes.find(n => n.id === link.target);
        if (a && b) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - 140) * 0.04;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      });

      graphData.nodes.forEach(n => {
        if (n !== draggedNode) {
          n.vx += (width / 2 - n.x) * 0.005;
          n.vy += (height / 2 - n.y) * 0.005;
          n.vx *= 0.85;
          n.vy *= 0.85;
          n.x += n.vx;
          n.y += n.vy;
        }
      });
    }

    function draw() {
      stepSimulation();

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      // Draw links
      graphData.links.forEach(link => {
        const a = graphData.nodes.find(n => n.id === link.source);
        const b = graphData.nodes.find(n => n.id === link.target);
        if (a && b) {
          if (activeCommunityFilter !== null && a.communityId !== activeCommunityFilter && b.communityId !== activeCommunityFilter) {
            return;
          }
          ctx.beginPath();
          if (link.confidence === 'INFERRED') {
            ctx.setLineDash([5, 4]);
          } else if (link.confidence === 'AMBIGUOUS') {
            ctx.setLineDash([2, 3]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = link.confidence === 'AMBIGUOUS' ? 'rgba(245, 158, 11, 0.45)' : 'rgba(99, 102, 241, 0.3)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      // Draw nodes
      graphData.nodes.forEach(n => {
        const dimmed = activeCommunityFilter !== null && n.communityId !== activeCommunityFilter;
        ctx.globalAlpha = dimmed ? 0.2 : 1.0;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, 2 * Math.PI);
        const isSelected = selectedNode && selectedNode.id === n.id;
        ctx.fillStyle = n.color || (n.type === 'target' ? '#06b6d4' : '#6366f1');
        ctx.fill();

        if (n.isGodHub) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 3;
          ctx.stroke();
        } else {
          ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = isSelected ? 3 : 1;
          ctx.stroke();
        }

        // Label
        ctx.fillStyle = '#f3f4f6';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        const label = n.path.split('/').pop();
        ctx.fillText(label, n.x, n.y + n.radius + 12);
        ctx.globalAlpha = 1.0;
      });

      ctx.restore();
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    let isPanning = false;
    let startX = 0, startY = 0;

    canvas.addEventListener('mousedown', e => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - transform.x) / transform.k;
      const mouseY = (e.clientY - rect.top - transform.y) / transform.k;

      draggedNode = graphData.nodes.find(n => {
        const dx = n.x - mouseX;
        const dy = n.y - mouseY;
        return Math.sqrt(dx * dx + dy * dy) <= n.radius;
      });

      if (draggedNode) {
        selectedNode = draggedNode;
        renderDetails(selectedNode);
      } else {
        isPanning = true;
        startX = e.clientX - transform.x;
        startY = e.clientY - transform.y;
      }
    });

    window.addEventListener('mousemove', e => {
      if (draggedNode) {
        const rect = canvas.getBoundingClientRect();
        draggedNode.x = (e.clientX - rect.left - transform.x) / transform.k;
        draggedNode.y = (e.clientY - rect.top - transform.y) / transform.k;
      } else if (isPanning) {
        transform.x = e.clientX - startX;
        transform.y = e.clientY - startY;
      }
    });

    window.addEventListener('mouseup', () => {
      draggedNode = null;
      isPanning = false;
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      transform.k = Math.max(0.2, Math.min(3.0, transform.k * zoomFactor));
    });
  </script>
</body>
</html>`;
}

/**
 * Writes visualizer report to file and returns absolute path.
 */
export function writeVisualizerReport(
  graph: DependencyGraph | Record<string, any>,
  options?: VisualizerOptions
): string {
  const html = generateVisualizerHtml(graph, options);
  const targetPath = options?.outputPath || path.resolve(process.cwd(), '.scp/visualizer.html');
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(targetPath, html, 'utf-8');
  return targetPath;
}
