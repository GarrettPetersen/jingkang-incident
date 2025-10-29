#!/usr/bin/env node
// Normalize connections: make some edges pure water (water type, no surface),
// and for the rest split combined land+water into separate edges.

import fs from 'node:fs';
import path from 'node:path';

const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');

// Unordered pairs that should be pure river-only links (major crossings)
// Use canonical latin ids only; avoid any Chinese id strings
const riverOnlyPairs = new Set([
    'zhenjiang|yangzhou',
    'jiujiang|ezhou',
    'jiujiang|yueyang',
]);

// Pairs along navigable rivers/canals that should have a parallel pure river edge in both directions
// Keep this empty unless you explicitly add canonical-id pairs; prevents accidental Chinese-id edges
const riverAlsoPairs = new Set([]);

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

    let madePureWater = 0;
    let splitCombined = 0;

    for (const e of edges) {
        const k = key(e.from, e.to);
        if (riverOnlyPairs.has(k)) {
            // force pure water-only; remove land attributes
            if (e.surface) madePureWater++;
            if (!e.water && e.river === true) e.water = 'river';
            if (!e.water) e.water = 'river';
            delete e.surface;
            delete e.river;
        } else {
            // if edge encodes both, split into land + pure water
            if (e.surface && (e.river === true || e.water)) {
                const waterType = e.water || 'river';
                const riverCopy = { from: e.from, to: e.to, water: waterType };
                delete e.river;
                delete e.water;
                splitCombined++;
                edges.push(riverCopy);
            }
        }
    }

    // Ensure riverAlsoPairs have parallel pure river edges in both directions
    const hasDirected = new Set(edges.map(e => `${e.from}|${e.to}|${e.water ? 'water:' + e.water : (e.surface || 'land')}`));
    let addedRiverAlso = 0;
    function ensureRiverEdge(a, b) {
        const sig = `${a}|${b}|water:river`;
        if (!hasDirected.has(sig)) {
            edges.push({ from: a, to: b, water: 'river' });
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
    console.log(`Normalized connections: ${madePureWater} forced pure-water, ${splitCombined} split land+water, ${addedRiverAlso} added river-only edges.`);
}

main();


