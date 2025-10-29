#!/usr/bin/env node
// Add bridging edges to connect isolated components, using city ids.

import fs from 'node:fs';
import path from 'node:path';

const CONN = path.resolve(process.cwd(), 'data/connections.json');
const CITIES = path.resolve(process.cwd(), 'data/cities.json');

function twoWay(from, to, surface) {
    const a = { from, to }; const b = { from: to, to: from };
    if (surface) { a.surface = surface; b.surface = surface; }
    return [a, b];
}

function main() {
    const cities = new Set(JSON.parse(fs.readFileSync(CITIES, 'utf8')).map(c => c.id));
    const data = JSON.parse(fs.readFileSync(CONN, 'utf8'));
    const edges = Array.isArray(data.edges) ? data.edges : [];
    const sig = new Set(edges.map(e => `${e.from}|${e.to}|${e.water ? 'water:' + e.water : (e.surface || 'land')}`));

    const planned = [
        // Connect Shangjing to Yanjing (NE block to core) – overland path
        ...twoWay('shangjing', 'yanjing', 'path'),
        // Connect Qin–Long–Sichuan corridor to core: Yan'an to Taiyuan and Hanzhong to Xiangyang
        ...twoWay('yanan', 'taiyuan', 'path'),
        ...twoWay('xingyuan', 'xiangyang', 'path'),
        // Connect Lingnan to coast/core: Guangzhou <-> Quanzhou (coast water), Yongzhou to Nanchang (mountain path)
        { from: 'guangzhou', to: 'quanzhou', water: 'coast' },
        { from: 'quanzhou', to: 'guangzhou', water: 'coast' },
        ...twoWay('yongzhou-gn', 'nanchang', 'path'),
    ];

    let added = 0, skipped = 0;
    for (const e of planned) {
        if (!cities.has(e.from) || !cities.has(e.to)) { skipped++; continue; }
        const key = `${e.from}|${e.to}|${e.water ? 'water:' + e.water : (e.surface || 'land')}`;
        if (sig.has(key)) continue;
        edges.push(e); sig.add(key); added++;
    }

    fs.writeFileSync(CONN, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Bridging edges added: ${added} (skipped ${skipped}).`);
}

main();


