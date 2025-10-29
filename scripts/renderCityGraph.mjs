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

  // Build nodes keyed by stable slug id; label from pinyin or zh
  const nodes = cities.map(c => ({
    id: c.id,
    label: (c.name_pinyin && c.name_pinyin.trim()) ? c.name_pinyin.trim() : (c.zh || c.id),
    type: c.type || 'city'
  }));
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));

  const edges = connections.edges
    .filter(e => nodeIndex.has(e.from) && nodeIndex.has(e.to))
    .map(e => ({ from: e.from, to: e.to, water: e.water || (e.river ? 'river' : ''), surface: e.surface || '' }));

  // Group parallel edges between the same unordered pair to offset them visually
  function pairKey(a, b) { return a < b ? (a + '|' + b) : (b + '|' + a); }
  const groups = new Map();
  for (const e of edges) {
    const k = pairKey(e.from, e.to);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

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
    .canal { stroke: #3fa3ff; stroke-width: 1.8; fill: none; }
    .coast { stroke: #6dc3ff; stroke-width: 1.8; fill: none; }
    .lake { stroke: #2a78c4; stroke-width: 1.8; fill: none; }
    .lake-marker { fill: #2a78c4; stroke: none; opacity: 0.9; }
  </style>
</head>
<body>
  <svg id="g"></svg>
  <script>
  const data = ${JSON.stringify(data)};

  // Build grouped parallel edges per unordered city pair for visual offsets
  function pairKey(a, b) { return a < b ? (a + '|' + b) : (b + '|' + a); }
  const groups = new Map();
  for (const e of data.edges) {
    const k = pairKey(e.from, e.to);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

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
  const L0 = 42; // slightly longer springs for more separation
  const K0 = 1.2; // a bit stiffer to stabilize
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

  // Init positions on a circle (function for multi-start)
  let X = new Float64Array(n), Y = new Float64Array(n);
  function initPositions(jitter = 0.15) {
    const R = 250;
    for (let i = 0; i < n; i++) {
      const base = 2 * Math.PI * i / n;
      const t = base + (Math.random() - 0.5) * jitter; // small angular jitter
      const r = R * (1 + (Math.random() - 0.5) * jitter * 0.5);
      X[i] = r * Math.cos(t);
      Y[i] = r * Math.sin(t);
    }
  }

  function kkLayout(maxOuter = 4500, eps = 8e-5) {
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

  // Build unique undirected edges for crossing checks
  const uniquePairs = [];
  const seenPairs = new Set();
  for (const e of data.edges) {
    const a = idToIdx.get(e.from), b = idToIdx.get(e.to);
    if (a == null || b == null || a === b) continue;
    const key = pairKey(a, b);
    if (!seenPairs.has(key)) { seenPairs.add(key); uniquePairs.push([a, b]); }
  }

  function segsIntersect(a1, a2, b1, b2) {
    // exclude shared endpoints
    if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) return false;
    const x1 = X[a1], y1 = Y[a1], x2 = X[a2], y2 = Y[a2];
    const x3 = X[b1], y3 = Y[b1], x4 = X[b2], y4 = Y[b2];
    function orient(ax, ay, bx, by, cx, cy) {
      const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      return Math.sign(v);
    }
    const o1 = orient(x1, y1, x2, y2, x3, y3);
    const o2 = orient(x1, y1, x2, y2, x4, y4);
    const o3 = orient(x3, y3, x4, y4, x1, y1);
    const o4 = orient(x3, y3, x4, y4, x2, y2);
    if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false; // treat colinear as non-crossing
    return (o1 !== o2) && (o3 !== o4);
  }

  function countCrossings() {
    let c = 0;
    for (let i = 0; i < uniquePairs.length; i++) {
      for (let j = i + 1; j < uniquePairs.length; j++) {
        const [a1, a2] = uniquePairs[i];
        const [b1, b2] = uniquePairs[j];
        if (segsIntersect(a1, a2, b1, b2)) c++;
      }
    }
    return c;
  }

  // Multi-start: try several initializations and keep the one with fewest crossings
  let bestX = null, bestY = null, bestC = Infinity;
  const tries = 140;
  for (let t = 0; t < tries; t++) {
    initPositions();
    kkLayout(9000, 1.0e-4);
    const c = countCrossings();
    if (c < bestC) {
      bestC = c;
      bestX = new Float64Array(X);
      bestY = new Float64Array(Y);
      if (c === 0) break;
    }
  }
  if (bestX) { X = bestX; Y = bestY; }

  // Orientation heuristics (optional): place hangzhou east of kaifeng if ids present
  const idxHZ = idToIdx.get('hangzhou');
  const idxKF = idToIdx.get('kaifeng');
  if (idxHZ != null && idxKF != null) {
    if (X[idxHZ] < X[idxKF]) {
      for (let i = 0; i < n; i++) X[i] = -X[i];
    }
  }

  // Corridor straightening: ensure key chains lie between their endpoints
  const corridors = [
    ['yangzhou','taizhou','haizhou']
  ];
  function straighten(ids) {
    const idxs = ids.map(id => idToIdx.get(id)).filter(i => i != null);
    if (idxs.length < 3) return;
    const a = idxs[0], b = idxs[idxs.length - 1];
    const dx = X[b] - X[a], dy = Y[b] - Y[a];
    const len = Math.hypot(dx, dy) || 1e-6;
    const px = -dy / len, py = dx / len; // perpendicular unit for tiny offsets
    for (let k = 1; k < idxs.length - 1; k++) {
      const t = k / (idxs.length - 1);
      // For a 3-node corridor like suzhou-js — taizhou — yangzhou, push the middle node further off-line
      const off = (idxs.length === 3 ? 12 : ((k % 2) ? 4 : -4));
      const i = idxs[k];
      X[i] = X[a] + t * dx + px * off;
      Y[i] = Y[a] + t * dy + py * off;
    }
  }
  for (const c of corridors) straighten(c);

  // Soft constraint: keep changzhou between suzhou-js and taizhou (if present)
  (function alignChangzhou() {
    const a = idToIdx.get('suzhou-js');
    const b = idToIdx.get('taizhou');
    const m = idToIdx.get('changzhou');
    if (a == null || b == null || m == null) return;
    const dx = X[b] - X[a], dy = Y[b] - Y[a];
    const len = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / len, uy = dy / len;
    // place at midpoint with tiny perpendicular offset to separate visuals
    const mx = (X[a] + X[b]) / 2, my = (Y[a] + Y[b]) / 2;
    const px = -uy, py = ux; // perpendicular
    const off = 8; // small offset
    X[m] = mx + px * off;
    Y[m] = my + py * off;
  })();

  // Targeted refinement: nudge Suzhou specifically to reduce crossings
  ;(function refineSuzhou() {
    const i = idToIdx.get('suzhou-js');
    if (i == null) return;
    function bestAround(radiusList, samples = 36) {
      let bx = X[i], by = Y[i];
      let bc = countCrossings();
      for (const r of radiusList) {
        let improved = false;
        for (let s = 0; s < samples; s++) {
          const ang = (2 * Math.PI * s) / samples;
          const nx = bx + r * Math.cos(ang);
          const ny = by + r * Math.sin(ang);
          const ox = X[i], oy = Y[i];
          X[i] = nx; Y[i] = ny;
          const c = countCrossings();
          if (c < bc) { bc = c; bx = nx; by = ny; improved = true; }
          X[i] = ox; Y[i] = oy;
        }
        X[i] = bx; Y[i] = by;
        if (!improved) break;
      }
    }
    bestAround([24, 16, 12, 8, 6, 4, 3, 2]);
  })();

  // Local refinement: hill-climb to reduce crossings by nudging nodes
  ;(function localRefineCrossings(maxIter = 2500) {
    function tryMoveNode(i, radius, samples = 16) {
      const ox = X[i], oy = Y[i];
      let bestX = ox, bestY = oy;
      let bestC = countCrossings();
      for (let s = 0; s < samples; s++) {
        const ang = (2 * Math.PI * s) / samples;
        const nx = ox + radius * Math.cos(ang);
        const ny = oy + radius * Math.sin(ang);
        X[i] = nx; Y[i] = ny;
        const c = countCrossings();
        if (c < bestC) { bestC = c; bestX = nx; bestY = ny; }
      }
      X[i] = bestX; Y[i] = bestY;
      return bestC;
    }
    function crossingCounts() {
      const counts = new Int32Array(n);
      for (let i = 0; i < uniquePairs.length; i++) {
        for (let j = i + 1; j < uniquePairs.length; j++) {
          const [a1, a2] = uniquePairs[i];
          const [b1, b2] = uniquePairs[j];
          if (segsIntersect(a1, a2, b1, b2)) {
            counts[a1]++; counts[a2]++; counts[b1]++; counts[b2]++;
          }
        }
      }
      return counts;
    }
    let last = countCrossings();
    for (let it = 0; it < maxIter; it++) {
      const radius = Math.max(2, 24 * (1 - it / maxIter));
      const counts = crossingCounts();
      // pick the worst node most of the time, otherwise random exploration
      let i = 0;
      if (Math.random() < 0.8) {
        let maxC = -1, maxI = 0;
        for (let k = 0; k < n; k++) { if (counts[k] > maxC) { maxC = counts[k]; maxI = k; } }
        i = maxI;
      } else {
        i = Math.floor(Math.random() * n);
      }
      const after = tryMoveNode(i, radius, 16);
      if (after === 0) break;
      if (it % 250 === 249) {
        const now = countCrossings();
        if (now >= last) break;
        last = now;
      }
    }
  })();

  // Targeted refinement: place Taizhou between Yangzhou and Haizhou, then fine-tune
  ;(function refineTaizhou() {
    const t = idToIdx.get('taizhou');
    const y = idToIdx.get('yangzhou');
    const h = idToIdx.get('haizhou');
    if (t == null || y == null || h == null) return;

    // Snap Taizhou near the midpoint of Yangzhou–Haizhou, with perpendicular offset chosen to reduce crossings
    const mx = (X[y] + X[h]) / 2;
    const my = (Y[y] + Y[h]) / 2;
    const dx = X[h] - X[y], dy = Y[h] - Y[y];
    const len = Math.hypot(dx, dy) || 1e-6;
    const px = -dy / len, py = dx / len; // perpendicular unit
    const off = 14; // small visual separation from the straight line

    const curC = countCrossings();
    // Try both perpendicular sides and keep the better
    let cand = [ [mx + px * off, my + py * off], [mx - px * off, my - py * off] ];
    let bestX = X[t], bestY = Y[t], bestC = curC;
    for (const [nx, ny] of cand) {
      const ox = X[t], oy = Y[t];
      X[t] = nx; Y[t] = ny;
      const c = countCrossings();
      if (c < bestC) { bestC = c; bestX = nx; bestY = ny; }
      X[t] = ox; Y[t] = oy;
    }
    X[t] = bestX; Y[t] = bestY;

    // Local micro search around the chosen spot
    function bestAround(radiusList, samples = 28) {
      let bx = X[t], by = Y[t];
      let bc = countCrossings();
      for (const r of radiusList) {
        let improved = false;
        for (let s = 0; s < samples; s++) {
          const ang = (2 * Math.PI * s) / samples;
          const nx = bx + r * Math.cos(ang);
          const ny = by + r * Math.sin(ang);
          const ox = X[t], oy = Y[t];
          X[t] = nx; Y[t] = ny;
          const c = countCrossings();
          if (c < bc) { bc = c; bx = nx; by = ny; improved = true; }
          X[t] = ox; Y[t] = oy;
        }
        X[t] = bx; Y[t] = by;
        if (!improved) break;
      }
    }
    bestAround([10, 7, 5, 3, 2]);
  })();

  // Global orientation: search over 4 rotations x optional mirror to maximize N-S and E-W separation
  const northIds = ['yanan','kaifeng','huaiyang','huaiyin'];
  const southIds = ['hangzhou','ningbo','nanchang','jianzhou-fj'];
  const eastIds  = ['ningbo','suzhou-js','jiaxing'];
  const westIds  = ['yanan','jiujiang','chengdu'];

  function indicesOf(arr) { return arr.map(id => idToIdx.get(id)).filter(i => i != null); }
  const northIdx = indicesOf(northIds);
  const southIdx = indicesOf(southIds);
  const eastIdx  = indicesOf(eastIds);
  const westIdx  = indicesOf(westIds);

  function avg(vals) { if (!vals.length) return 0; let s = 0; for (const v of vals) s += v; return s / vals.length; }

  function scoreOrientation(x, y) {
    const northY = avg(northIdx.map(i => y[i]));
    const southY = avg(southIdx.map(i => y[i]));
    const eastX  = avg(eastIdx.map(i => x[i]));
    const westX  = avg(westIdx.map(i => x[i]));
    // Larger is better: south below north (higher y), east to the right of west (higher x)
    return (southY - northY) + (eastX - westX);
  }

  function applyTransform(theta, mirrorX) {
    const ct = Math.cos(theta), st = Math.sin(theta);
    const tx = new Float64Array(n), ty = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let nx =  ct * X[i] - st * Y[i];
      let ny =  st * X[i] + ct * Y[i];
      if (mirrorX) nx = -nx;
      tx[i] = nx; ty[i] = ny;
    }
    return { tx, ty };
  }

  (function orientBest() {
    let best = -Infinity, bestX = X, bestY = Y;
    const steps = 360; // try 1-degree increments
    for (let k = 0; k < steps; k++) {
      const th = (2 * Math.PI * k) / steps;
      for (const mirror of [false, true]) {
        const { tx, ty } = applyTransform(th, mirror);
        const s = scoreOrientation(tx, ty);
        if (s > best) { best = s; bestX = tx; bestY = ty; }
      }
    }
    X = bestX; Y = bestY;
  })();

  // Pull certain nodes slightly inland to avoid edge crossings around Changzhou
  (function pullInland() {
    const inlandIds = ['tongzhou','suzhou-js'];
    // centroid
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += X[i]; cy += Y[i]; }
    cx /= n; cy /= n;
    for (const id of inlandIds) {
      const idx = idToIdx.get(id);
      if (idx == null) continue;
      X[idx] = cx + (X[idx] - cx) * 0.8;
      Y[idx] = cy + (Y[idx] - cy) * 0.8;
    }
  })();

  // Orientation heuristics (optional): place hangzhou east of kaifeng if ids present
  // (already applied before straightening)

  // Normalize to viewport
  function normalizePositions(width, height, margin = 60) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]); }
    const sx = (width - 2*margin) / (maxX - minX || 1);
    const sy = (height - 2*margin) / (maxY - minY || 1);
    const s = Math.min(sx, sy); // uniform scale to avoid axis squish
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    for (let i = 0; i < n; i++) {
      X[i] = width/2 + (X[i] - cx) * s;
      Y[i] = height/2 + (Y[i] - cy) * s;
    }
  }
  const width = window.innerWidth, height = window.innerHeight;
  normalizePositions(width, height);

  const svg = document.getElementById('g');
  // Draw edges with perpendicular offsets for parallel links
  const OFF = 6; // px between parallel edges
  for (const [k, group] of groups.entries()) {
    // sort so we render river beneath roads/paths
    group.sort((a, b) => {
      const aw = a.water ? 1 : 0, bw = b.water ? 1 : 0; return bw - aw; // draw water first
    });
    // Deduplicate within an unordered pair: render at most one edge per kind (water type or surface)
    const seenKinds = new Set();
    const uniq = [];
    for (const e of group) {
      const kind = e.water ? ('water:' + e.water) : ('surface:' + (e.surface || 'road'));
      if (seenKinds.has(kind)) continue;
      seenKinds.add(kind);
      uniq.push(e);
    }
    const aId = (uniq[0] || group[0]).from, bId = (uniq[0] || group[0]).to;
    const i = idToIdx.get(aId), j = idToIdx.get(bId);
    if (i == null || j == null) continue;
    const dx = X[j] - X[i], dy = Y[j] - Y[i];
    const dist = Math.hypot(dx, dy) || 1e-6;
    const px = -dy / dist, py = dx / dist; // unit perpendicular
    const m = uniq.length;
    for (let idx = 0; idx < m; idx++) {
      const e = uniq[idx];
      const offset = (idx - (m - 1) / 2) * OFF;
      const ox = px * offset, oy = py * offset;
      const x1 = X[i] + ox, y1 = Y[i] + oy;
      const x2 = X[j] + ox, y2 = Y[j] + oy;
       if (e.water && !e.surface) {
         // Water edges as straight lines with different shades
        const line = document.createElementNS('http://www.w3.org/2000/svg','line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
         const cls = (e.water === 'canal') ? 'canal' : (e.water === 'coast') ? 'coast' : (e.water === 'lake') ? 'lake' : 'river';
         line.setAttribute('class', cls);
        svg.appendChild(line);
         // Lake marker at midpoint for lake edges
         if (e.water === 'lake') {
           const circ = document.createElementNS('http://www.w3.org/2000/svg','circle');
           const mx = (x1 + x2) / 2;
           const my = (y1 + y2) / 2;
           circ.setAttribute('cx', mx);
           circ.setAttribute('cy', my);
           circ.setAttribute('r', 5);
           circ.setAttribute('class', 'lake-marker');
           svg.appendChild(circ);
         }
      } else {
        // Land edges as gentle quadratic curves to reduce crossings
        const path = document.createElementNS('http://www.w3.org/2000/svg','path');
        // control point at midpoint offset further along perpendicular
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const CURVE = 0.35 * Math.hypot(dx, dy); // scale with length
        const cx = mx + px * offset * 1.8; // amplify separation
        const cy = my + py * offset * 1.8;
        path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' Q ' + cx + ' ' + cy + ' ' + x2 + ' ' + y2);
        if (e.surface === 'path') {
          path.setAttribute('class','path');
        } else {
          path.setAttribute('class','road');
        }
        path.setAttribute('fill','none');
        svg.appendChild(path);
      }
    }
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


