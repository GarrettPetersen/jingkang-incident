#!/usr/bin/env node
// Ensure yanan <-> xingyuan path exists

import fs from 'node:fs';
import path from 'node:path';

const CONN = path.resolve(process.cwd(), 'data/connections.json');

function twoWay(from, to, surface) {
    const a = { from, to }; const b = { from: to, to: from };
    if (surface) { a.surface = surface; b.surface = surface; }
    return [a, b];
}

function main() {
    const data = JSON.parse(fs.readFileSync(CONN, 'utf8'));
    const edges = Array.isArray(data.edges) ? data.edges : [];
    const sig = new Set(edges.map(e => `${e.from}|${e.to}|${e.water ? 'water:' + e.water : (e.surface || 'land')}`));
    let added = 0;
    for (const e of twoWay('yanan', 'xingyuan', 'path')) {
        const key = `${e.from}|${e.to}|${e.surface || ''}`;
        if (sig.has(key)) continue;
        edges.push(e); sig.add(key); added++;
    }
    fs.writeFileSync(CONN, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Added yanan<->xingyuan path edges: ${added}.`);
}

main();


