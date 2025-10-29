#!/usr/bin/env node
// Merge small cities into nearby hubs and update connections accordingly.

import fs from 'node:fs';
import path from 'node:path';

const CITIES = path.resolve(process.cwd(), 'data/cities.json');
const CONNS = path.resolve(process.cwd(), 'data/connections.json');

// fromId -> toId
const merges = {
    'cizhou': 'daming',
    'zhenzhou': 'zhenjiang',
    'suzhou-anhui': 'huaiyang',
    'tongzhou': 'yangzhou',
    'wuzhou': 'shaoxing',
    'yongzhou-gn': 'guangzhou',
    'wuguocheng': 'shangjing',
    // Simplify Qin–Long corridor to two anchors (延安–興元)
    'qinzhou': 'yanan',
    'longzhou': 'yanan',
    'fengzhou': 'xingyuan',
};

function mergeCities() {
    const cities = JSON.parse(fs.readFileSync(CITIES, 'utf8'));
    const byId = new Map(cities.map(c => [c.id, c]));
    const toRemove = new Set();

    for (const [from, to] of Object.entries(merges)) {
        const src = byId.get(from);
        const dst = byId.get(to);
        if (!src || !dst) continue;
        // Move aliases and base names into target aliases for backward compatibility
        const addAlias = (str) => {
            if (!str) return;
            if (!Array.isArray(dst.aliases)) dst.aliases = [];
            if (!dst.aliases.includes(str)) dst.aliases.push(str);
        };
        addAlias(src.zh || src.name_zh);
        addAlias(src.pinyin || src.name_pinyin);
        if (Array.isArray(src.aliases)) {
            for (const a of src.aliases) addAlias(a);
        }
        toRemove.add(from);
    }

    const kept = cities.filter(c => !toRemove.has(c.id));
    fs.writeFileSync(CITIES, JSON.stringify(kept, null, 2), 'utf8');
    console.log(`Merged cities: removed ${toRemove.size} entries.`);
}

function updateConnections() {
    const data = JSON.parse(fs.readFileSync(CONNS, 'utf8'));
    let edges = Array.isArray(data.edges) ? data.edges : [];
    // Replace endpoints
    for (const e of edges) {
        if (merges[e.from]) e.from = merges[e.from];
        if (merges[e.to]) e.to = merges[e.to];
    }
    // Deduplicate
    const seen = new Set();
    const out = [];
    for (const e of edges) {
        const kind = e.water ? ('water:' + e.water) : (e.surface || 'land');
        const key = `${e.from}|${e.to}|${kind}`;
        if (seen.has(key)) continue;
        seen.add(key); out.push(e);
    }
    fs.writeFileSync(CONNS, JSON.stringify({ edges: out }, null, 2), 'utf8');
    console.log(`Updated connections: ${out.length} edges after merge.`);
}

function main() {
    mergeCities();
    updateConnections();
}

main();


