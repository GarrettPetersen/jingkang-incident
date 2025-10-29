#!/usr/bin/env node
// Verify connections reference existing city ids.

import fs from 'node:fs';
import path from 'node:path';

const CITIES = path.resolve(process.cwd(), 'data/cities.json');
const CONNS = path.resolve(process.cwd(), 'data/connections.json');

function main() {
    const cities = JSON.parse(fs.readFileSync(CITIES, 'utf8'));
    const edges = JSON.parse(fs.readFileSync(CONNS, 'utf8')).edges || [];
    const ids = new Set(cities.map(c => c.id));

    // 1) Check endpoints exist
    const invalid = [];
    for (const e of edges) {
        const a = e.from, b = e.to;
        const aOk = ids.has(a); const bOk = ids.has(b);
        if (!aOk || !bOk) invalid.push({ from: a, to: b, surface: e.surface, water: e.water, aOk, bOk });
    }
    if (invalid.length === 0) {
        console.log('All connections reference existing city ids.');
    } else {
        console.log(`Invalid connections: ${invalid.length}`);
        // Print a few examples grouped by missing endpoint
        const byKey = new Map();
        for (const x of invalid) {
            const k = `${x.aOk ? '' : 'from:' + x.from} ${x.bOk ? '' : 'to:' + x.to}`.trim();
            const key = k || `${x.from}|${x.to}`;
            if (!byKey.has(key)) byKey.set(key, 0);
            byKey.set(key, byKey.get(key) + 1);
        }
        let shown = 0;
        for (const [k, cnt] of byKey.entries()) {
            console.log(`- ${k} (${cnt})`);
            if (++shown >= 10) break;
        }
    }

    // 2) Check illegal dual land kinds (both road and path) for the same unordered pair
    function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
    const landKinds = new Map(); // pairKey -> Set<'road'|'path'>
    for (const e of edges) {
        if (!e.surface) continue;
        if (e.surface !== 'road' && e.surface !== 'path') continue;
        const k = pairKey(e.from, e.to);
        if (!landKinds.has(k)) landKinds.set(k, new Set());
        landKinds.get(k).add(e.surface);
    }
    const illegal = [];
    for (const [k, set] of landKinds.entries()) {
        if (set.has('road') && set.has('path')) illegal.push(k);
    }
    if (illegal.length) {
        console.log(`Illegal road+path pairs: ${illegal.length}`);
        for (const k of illegal) console.log(`- ${k}`);
        process.exitCode = 1;
    }
}

main();


