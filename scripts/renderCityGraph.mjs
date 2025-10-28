#!/usr/bin/env node
// Render the city graph to an HTML (SVG) using a Kamada-Kawai layout.
// Edges:
// - river-only: blue solid
// - road: brown solid
// - path: brown dashed

import fs from 'node:fs';
import path from 'node:path';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');
const OUT_HTML = path.resolve(process.cwd(), 'dist/city-graph.html');

function main() {
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  const connections = JSON.parse(fs.readFileSync(CONN_PATH, 'utf8'));

  // Deduplicate nodes by name_zh; prefer higher-rank admin types so edges land on a single node
  const rank = new Map([
    ['capital', 5], ['prefecture-capital', 4], ['city', 3], ['prefecture', 2], ['county', 1], ['town', 1], ['village', 1], ['port', 3], ['market', 2], ['fort', 1], ['fortress', 1], ['garrison', 1]
  ]);
  const unique = new Map();
  for (const c of cities) {
    const id = c.name_zh;
    const r = rank.get((c.type || '').toLowerCase()) || 0;
    const label = (c.name_pinyin && c.name_pinyin.trim()) ? c.name_pinyin.trim() : id;
    if (!unique.has(id) || r > unique.get(id)._r) {
      unique.set(id, { id, label, type: c.type, _r: r });
    }
  }
  const nodes = Array.from(unique.values()).map(({ _r, ...n }) => n);
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));

  const edges = connections.edges
    .filter(e => nodeIndex.has(e.from) && nodeIndex.has(e.to))
    .map(e => ({ from: e.from, to: e.to, river: !!e.river, surface: e.surface || '' }));

  const data = { nodes, edges };
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>City Graph</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; }
    svg { width: 100vw; height: 100vh; background: #faf8f3; }
    .node circle { fill: #f2efe6; stroke: #555; stroke-width: 1.2; }
    .label { font-size: 11px; fill: #333; pointer-events: none; }
    .road { stroke: #8B4513; stroke-width: 1.6; fill: none; }
    .path { stroke: #8B4513; stroke-width: 1.6; fill: none; stroke-dasharray: 6 4; }
    .river { stroke: #1f77b4; stroke-width: 1.8; fill: none; }
  </style>
</head>
<body>
  <svg id="g"></svg>
  <script>
  const data = ${JSON.stringify(data)};

  // Build undirected graph distances for Kamada-Kawai
  const n = data.nodes.length;
  const idToIdx = new Map(data.nodes.map((d, i) => [d.id, i]));
  const adj = Array.from({ length: n }, () => []);
  for (const e of data.edges) {
    const a = idToIdx.get(e.from), b = idToIdx.get(e.to);
    if (a == null || b == null) continue;
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  }

  function floydWarshall() {
    const INF = 1e9;
    const dist = Array.from({ length: n }, () => Array(n).fill(INF));
    for (let i = 0; i < n; i++) dist[i][i] = 0;
    for (let i = 0; i < n; i++) for (const j of adj[i]) dist[i][j] = 1;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const dik = dist[i][k]; if (dik === INF) continue;
        const dk = dist[k]; const di = dist[i];
        for (let j = 0; j < n; j++) {
          const via = dik + dk[j];
          if (via < di[j]) di[j] = via;
        }
      }
    }
    return dist;
  }

  const D = floydWarshall();
  const INF = 1e9;
  const L0 = 40; // spring natural length scale
  const K0 = 1.0;
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  const K = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dij = D[i][j];
      if (dij < INF/2 && dij > 0) {
        L[i][j] = L0 * dij;
        K[i][j] = K0 / (dij * dij);
      }
    }
  }

  // Init positions on a circle
  let X = new Float64Array(n), Y = new Float64Array(n);
  const R = 250;
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * i / n;
    X[i] = R * Math.cos(t);
    Y[i] = R * Math.sin(t);
  }

  function kkLayout(maxOuter = 50, eps = 1e-2) {
    function dE(i) {
      let dEx = 0, dEy = 0, d2Exx = 0, d2Eyy = 0, d2Exy = 0;
      const xi = X[i], yi = Y[i];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const k = K[i][j]; if (k === 0) continue;
        const l = L[i][j];
        const dx = xi - X[j];
        const dy = yi - Y[j];
        let dist = Math.hypot(dx, dy);
        if (dist < 1e-6) dist = 1e-6;
        const common = k * (1 - l / dist);
        dEx += common * dx;
        dEy += common * dy;
        const dist3 = dist * dist * dist;
        d2Exx += k * (1 - l * (dy*dy) / dist3);
        d2Eyy += k * (1 - l * (dx*dx) / dist3);
        d2Exy += k * (l * dx * dy / dist3);
      }
      return { dEx, dEy, d2Exx, d2Eyy, d2Exy };
    }

    for (let it = 0; it < maxOuter; it++) {
      // choose node with max gradient
      let maxG = 0, maxI = 0;
      for (let i = 0; i < n; i++) {
        const { dEx, dEy } = dE(i);
        const g = Math.hypot(dEx, dEy);
        if (g > maxG) { maxG = g; maxI = i; }
      }
      if (maxG < eps) break;
      // Newton-Raphson on node maxI
      for (let inner = 0; inner < 400; inner++) {
        const { dEx, dEy, d2Exx, d2Eyy, d2Exy } = dE(maxI);
        const a = d2Exx, b = d2Exy, c = d2Exy, d = d2Eyy;
        const det = a * d - b * c || 1e-9;
        const dx = (-d * dEx + b * dEy) / det;
        const dy = ( c * dEx - a * dEy) / det;
        X[maxI] += dx; Y[maxI] += dy;
        if (Math.hypot(dx, dy) < eps) break;
      }
    }
  }

  kkLayout(1000, 5e-4);

  // Orientation heuristics: bring 燕京 to top; place 杭州 east of 汴京 if needed
  const idxYJ = idToIdx.get('燕京');
  const idxGZ = idToIdx.get('廣州');
  if (idxYJ != null && idxGZ != null) {
    if (Y[idxYJ] > Y[idxGZ]) { // flip vertically
      for (let i = 0; i < n; i++) Y[i] = -Y[i];
    }
  }
  const idxHZ = idToIdx.get('杭州');
  const idxKF = idToIdx.get('汴京');
  if (idxHZ != null && idxKF != null) {
    if (X[idxHZ] < X[idxKF]) {
      for (let i = 0; i < n; i++) X[i] = -X[i];
    }
  }

  // Normalize to viewport
  function normalizePositions(width, height, margin = 60) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]); }
    const sx = (width - 2*margin) / (maxX - minX || 1);
    const sy = (height - 2*margin) / (maxY - minY || 1);
    for (let i = 0; i < n; i++) {
      X[i] = margin + (X[i] - minX) * sx;
      Y[i] = margin + (Y[i] - minY) * sy;
    }
  }
  const width = window.innerWidth, height = window.innerHeight;
  normalizePositions(width, height);

  const svg = document.getElementById('g');
  // Draw edges
  for (const e of data.edges) {
    const i = idToIdx.get(e.from), j = idToIdx.get(e.to);
    if (i == null || j == null) continue;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', X[i]);
    line.setAttribute('y1', Y[i]);
    line.setAttribute('x2', X[j]);
    line.setAttribute('y2', Y[j]);
    if (e.river && !e.surface) {
      line.setAttribute('class','river');
    } else if (e.surface === 'path') {
      line.setAttribute('class','path');
    } else {
      line.setAttribute('class','road');
    }
    svg.appendChild(line);
  }

  // Draw nodes
  for (let i = 0; i < n; i++) {
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class','node');
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx', X[i]);
    c.setAttribute('cy', Y[i]);
    c.setAttribute('r', 6);
    g.appendChild(c);
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('class','label');
    t.setAttribute('x', X[i] + 8);
    t.setAttribute('y', Y[i] - 8);
    t.textContent = data.nodes[i].label;
    g.appendChild(t);
    svg.appendChild(g);
  }
  </script>
</body>
</html>`;

  const outDir = path.dirname(OUT_HTML);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log(`Wrote ${OUT_HTML}`);
}

main();


