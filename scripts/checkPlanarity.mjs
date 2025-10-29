#!/usr/bin/env node
// Quick planarity checker for our city graph.
// It uses necessary condition (m <= 3n - 6 for n>=3) and detects K5 or K3,3 subgraphs.
// Note: This is sufficient to prove non-planarity, but may say "possibly planar" when minors exist.

import fs from 'node:fs';
import path from 'node:path';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');

function loadGraph() {
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  const conns = JSON.parse(fs.readFileSync(CONN_PATH, 'utf8'));
  const ids = cities.map(c => c.id);
  const idIndex = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const adj = Array.from({ length: n }, () => Array(n).fill(false));
  const edges = new Set();
  for (const e of conns.edges || []) {
    const a = idIndex.get(e.from);
    const b = idIndex.get(e.to);
    if (a == null || b == null || a === b) continue;
    const i = Math.min(a, b), j = Math.max(a, b);
    const key = `${i}|${j}`;
    if (!edges.has(key)) {
      edges.add(key);
      adj[i][j] = true;
      adj[j][i] = true;
    }
  }
  return { ids, adj };
}

function connectedComponents(adj) {
  const n = adj.length;
  const seen = Array(n).fill(false);
  const comps = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const stack = [s];
    const comp = [];
    seen[s] = true;
    while (stack.length) {
      const u = stack.pop();
      comp.push(u);
      for (let v = 0; v < n; v++) {
        if (adj[u][v] && !seen[v]) { seen[v] = true; stack.push(v); }
      }
    }
    comps.push(comp.sort((a, b) => a - b));
  }
  return comps;
}

function edgeCount(adj, comp) {
  let m = 0;
  for (let i = 0; i < comp.length; i++) {
    for (let j = i + 1; j < comp.length; j++) {
      if (adj[comp[i]][comp[j]]) m++;
    }
  }
  return m;
}

function hasK5(adj, comp) {
  const k = comp.length;
  if (k < 5) return null;
  // Iterate over all 5-vertex subsets
  const verts = comp;
  for (let a = 0; a < k; a++)
    for (let b = a + 1; b < k; b++)
      for (let c = b + 1; c < k; c++)
        for (let d = c + 1; d < k; d++)
          for (let e = d + 1; e < k; e++) {
            const S = [verts[a], verts[b], verts[c], verts[d], verts[e]];
            let ok = true;
            for (let i = 0; i < 5 && ok; i++) {
              for (let j = i + 1; j < 5; j++) {
                if (!adj[S[i]][S[j]]) { ok = false; break; }
              }
            }
            if (ok) return S;
          }
  return null;
}

function hasK33(adj, comp) {
  const k = comp.length;
  if (k < 6) return null;
  const v = comp;
  // Enumerate all 6-sets then all 3-3 partitions
  for (let a = 0; a < k; a++)
    for (let b = a + 1; b < k; b++)
      for (let c = b + 1; c < k; c++)
        for (let d = c + 1; d < k; d++)
          for (let e = d + 1; e < k; e++)
            for (let f = e + 1; f < k; f++) {
              const S = [v[a], v[b], v[c], v[d], v[e], v[f]];
              // choose 3 of S as A (the rest are B)
              for (let i1 = 0; i1 < 4; i1++)
                for (let i2 = i1 + 1; i2 < 5; i2++)
                  for (let i3 = i2 + 1; i3 < 6; i3++) {
                    const A = [S[i1], S[i2], S[i3]];
                    const B = S.filter((x, idx) => idx !== i1 && idx !== i2 && idx !== i3);
                    let ok = true;
                    // Check all 3x3 cross edges exist
                    for (let i = 0; i < 3 && ok; i++) {
                      for (let j = 0; j < 3; j++) {
                        if (!adj[A[i]][B[j]]) { ok = false; break; }
                      }
                    }
                    if (ok) return { A, B };
                  }
            }
  return null;
}

function main() {
  const { ids, adj } = loadGraph();
  const comps = connectedComponents(adj);
  let allPlanar = true;
  for (const comp of comps) {
    const n = comp.length;
    const m = edgeCount(adj, comp);
    const name = comp.map(i => ids[i]);
    if (n === 1) { continue; }
    // Necessary bound
    if (n >= 3 && m > 3 * n - 6) {
      allPlanar = false;
      console.log(`[nonplanar] component nodes=${n}, edges=${m} violates m <= 3n-6. nodes:`, name);
      continue;
    }
    const k5 = hasK5(adj, comp);
    if (k5) {
      allPlanar = false;
      console.log(`[nonplanar] K5 subgraph found among:`, k5.map(i => ids[i]));
      continue;
    }
    const k33 = hasK33(adj, comp);
    if (k33) {
      allPlanar = false;
      console.log(`[nonplanar] K3,3 subgraph found between A and B:`, k33.A.map(i => ids[i]), k33.B.map(i => ids[i]));
      continue;
    }
    console.log(`[possibly planar] component nodes=${n}, edges=${m}. nodes:`, name);
  }
  if (allPlanar) {
    console.log('Graph is possibly planar (no violations detected).');
    process.exit(0);
  } else {
    process.exit(2);
  }
}

main();


