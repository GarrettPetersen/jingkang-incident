#!/usr/bin/env node
// Add connections for newly added hubs using city ids (not zh names)

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
        // Qin–Long–Sichuan corridor (mountain paths)
        ...twoWay('yanan', 'qinzhou', 'path'),
        ...twoWay('qinzhou', 'fengzhou', 'path'),
        ...twoWay('fengzhou', 'longzhou', 'path'),
        ...twoWay('longzhou', 'xingyuan', 'path'),
        ...twoWay('xingyuan', 'lizhou', 'path'),
        ...twoWay('lizhou', 'chengdu', 'path'),

        // Upper/middle Yangzi & Dongting basin
        ...twoWay('yueyang', 'tanzhou', 'road'),
        { from: 'yueyang', to: 'tanzhou', water: 'lake' },
        { from: 'tanzhou', to: 'yueyang', water: 'lake' },
        ...twoWay('yueyang', 'jiujiang', 'road'),
        { from: 'yueyang', to: 'jiujiang', water: 'river' },
        { from: 'jiujiang', to: 'yueyang', water: 'river' },
        ...twoWay('ezhou', 'yueyang', 'road'),
        ...twoWay('ezhou', 'jiujiang', 'road'),
        { from: 'ezhou', to: 'jiujiang', water: 'river' },
        { from: 'jiujiang', to: 'ezhou', water: 'river' },
        ...twoWay('xiangyang', 'ezhou', 'road'),
        ...twoWay('xiangyang', 'yingchang', 'road'),

        // Jiangnan canal/coast and Shaoxing/Ningbo
        ...twoWay('shaoxing', 'hangzhou', 'road'),
        ...twoWay('shaoxing', 'ningbo', 'path'),
        { from: 'hangzhou', to: 'shaoxing', water: 'canal' },
        { from: 'shaoxing', to: 'hangzhou', water: 'canal' },
        { from: 'shaoxing', to: 'ningbo', water: 'canal' },
        { from: 'ningbo', to: 'shaoxing', water: 'canal' },

        // South China inland
        ...twoWay('yongzhou-gn', 'guangzhou', 'path'),

        // Northeast
        ...twoWay('wuguocheng', 'shangjing', 'path'),

        // Central plains
        ...twoWay('yingchang', 'kaifeng', 'road'),
        ...twoWay('yingchang', 'huaiyang', 'road'),
    ];

    let added = 0, skipped = 0;
    for (const e of planned) {
        const s = `${e.from}|${e.to}|${e.water ? 'water:' + e.water : (e.surface || 'land')}`;
        if (!cities.has(e.from) || !cities.has(e.to)) { skipped++; continue; }
        if (sig.has(s)) continue;
        edges.push(e); sig.add(s); added++;
    }

    fs.writeFileSync(CONN, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Extended connections (ids): added ${added}, skipped ${skipped}.`);
}

main();


