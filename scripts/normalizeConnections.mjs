#!/usr/bin/env node
// Normalize connections: make some edges pure river (river=true, no surface),
// and for the rest remove river flag if a land route exists.

import fs from 'node:fs';
import path from 'node:path';

const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');

// Unordered pairs that should be pure river-only links (major crossings)
const riverOnlyPairs = new Set([
    '揚州|鎮江府',
    '建康府|真州',
    '常州|揚州',
    '泗州|楚州',
    '明州|定海縣',
]);

// Pairs along navigable river/canal on the same bank — should have BOTH land and a pure river edge
const riverAlsoPairs = new Set([
    '鎮江府|建康府',
    '鄂州|江州',
    '江州|饒州',
    '平江府|常州',
    '平江府|杭州',
    '杭州|越州',
    '越州|明州',
    '福州|泉州',
    '泉州|廣州',
    '揚州|泰州',
    '泰州|通州',
    '通州|海州',
]);

function key(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function main() {
    if (!fs.existsSync(CONN_PATH)) {
        console.error('connections.json not found');
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(CONN_PATH, 'utf8'));
    let edges = Array.isArray(data.edges) ? data.edges : [];

    let madePureRiver = 0;
    let clearedRiverFlag = 0;

    for (const e of edges) {
        const k = key(e.from, e.to);
        if (riverOnlyPairs.has(k)) {
            // force pure river; remove land edges by converting them
            if (e.surface) madePureRiver++;
            e.river = true;
            delete e.surface;
        } else {
            // if edge encodes both, split into land + pure river
            if (e.river === true && e.surface) {
                const riverCopy = { from: e.from, to: e.to, river: true };
                e.river = false;
                clearedRiverFlag++;
                edges.push(riverCopy);
            }
        }
    }

    // Ensure riverAlsoPairs have parallel pure river edges in both directions
    const hasDirected = new Set(edges.map(e => `${e.from}|${e.to}|${e.river ? 'river' : e.surface || 'land'}`));
    let addedRiverAlso = 0;
    function ensureRiverEdge(a, b) {
        const sig = `${a}|${b}|river`;
        if (!hasDirected.has(sig)) {
            edges.push({ from: a, to: b, river: true });
            hasDirected.add(sig);
            addedRiverAlso++;
        }
    }
    for (const pair of riverAlsoPairs) {
        const [a, b] = pair.split('|');
        ensureRiverEdge(a, b);
        ensureRiverEdge(b, a);
    }

    fs.writeFileSync(CONN_PATH, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Normalized connections: ${madePureRiver} forced pure-river, ${clearedRiverFlag} split land+river, ${addedRiverAlso} added river-only edges.`);
}

main();


