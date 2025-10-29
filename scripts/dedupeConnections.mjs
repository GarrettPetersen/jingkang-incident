#!/usr/bin/env node
// Deduplicate connections: remove exact duplicate edges (same from,to,surface/water)

import fs from 'node:fs';
import path from 'node:path';

const CONN = path.resolve(process.cwd(), 'data/connections.json');

function main() {
    const data = JSON.parse(fs.readFileSync(CONN, 'utf8'));
    const edges = Array.isArray(data.edges) ? data.edges : [];
    const seen = new Set();
    const out = [];
    let removed = 0;
    for (const e of edges) {
        const tag = e.water ? 'water:' + e.water : (e.surface || 'land');
        const key = `${e.from}|${e.to}|${tag}`;
        if (seen.has(key)) { removed++; continue; }
        seen.add(key); out.push(e);
    }
    fs.writeFileSync(CONN, JSON.stringify({ edges: out }, null, 2), 'utf8');
    console.log(`Deduped connections: removed ${removed}, kept ${out.length}.`);
}

main();


