#!/usr/bin/env node
// Audit (and optionally fix) surfaces: roads only in northern plains; else prefer paths.
// Usage: node scripts/auditTerrainSurfaces.mjs [--fix]

import fs from 'node:fs';
import path from 'node:path';

const FIX = process.argv.includes('--fix');
const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');

function main() {
  const data = JSON.parse(fs.readFileSync(CONN_PATH, 'utf8'));
  const edges = Array.isArray(data.edges) ? data.edges : [];

  // Northern plains where cavalry can operate freely (keep roads allowed)
  const northPlains = new Set(['kaifeng','yanan','huaiyin','huaiyang','suzhou-anhui','yangzhou']);

  let violations = 0, fixes = 0;
  for (const e of edges) {
    if (!e || !e.surface) continue;
    const aNorth = northPlains.has(e.from);
    const bNorth = northPlains.has(e.to);
    const isSouthOrMountain = !(aNorth && bNorth);
    if (e.surface === 'road' && isSouthOrMountain) {
      violations++;
      console.log(`[violation] road in non-northern-plains: ${e.from} -> ${e.to}`);
      if (FIX) {
        e.surface = 'path';
        fixes++;
      }
    }
  }

  if (FIX) {
    fs.writeFileSync(CONN_PATH, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Applied ${fixes} fixes. Wrote ${CONN_PATH}`);
  } else {
    console.log(`${violations} violations found.`);
  }
}

main();


