#!/usr/bin/env node
// Remove direct zhaozhou<->huaiyang edge; add zhaozhou->daming->kaifeng->huaiyang roads (bidirectional)

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
    let edges = Array.isArray(data.edges) ? data.edges : [];

    // Drop direct Zhaozhou <-> Huaiyang of any kind
    const drop = new Set([
        'zhaozhou|huaiyang', 'huaiyang|zhaozhou'
    ]);
    const before = edges.length;
    edges = edges.filter(e => !drop.has(`${e.from}|${e.to}`));
    const removed = before - edges.length;

    // Add roads: zhaozhou -> daming -> kaifeng -> huaiyang (both ways)
    const needed = [
        ...twoWay('zhaozhou', 'daming', 'road'),
        ...twoWay('daming', 'kaifeng', 'road'),
        ...twoWay('kaifeng', 'huaiyang', 'road'),
    ];
    const sig = new Set(edges.map(e => `${e.from}|${e.to}|${e.surface || ''}|${e.water || ''}`));
    let added = 0;
    for (const e of needed) {
        const key = `${e.from}|${e.to}|${e.surface || ''}|${e.water || ''}`;
        if (sig.has(key)) continue;
        edges.push(e); sig.add(key); added++;
    }

    fs.writeFileSync(CONN, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Removed ${removed} crossing edge(s); added ${added} road edge(s).`);
}

main();


