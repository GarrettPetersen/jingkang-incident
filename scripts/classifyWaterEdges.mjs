#!/usr/bin/env node
// Classify water edges in data/connections.json as river, canal, or coast (optionally lake).
// Converts legacy { river: true } into { water: 'river' | 'canal' | 'coast' | 'lake' }.

import fs from 'node:fs';
import path from 'node:path';

const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');

// Helper to test an id or zh name against any of tokens
function idMatches(id, tokens) {
    if (!id) return false;
    const s = id.toString().toLowerCase();
    return tokens.some(t => s.includes(t));
}

function pairKey(a, b) {
    const A = (a || '').toString().toLowerCase();
    const B = (b || '').toString().toLowerCase();
    return A < B ? `${A}|${B}` : `${B}|${A}`;
}

function main() {
    if (!fs.existsSync(CONN_PATH)) {
        console.error('connections.json not found');
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(CONN_PATH, 'utf8'));
    const edges = Array.isArray(data.edges) ? data.edges : [];

    let converted = 0; let retyped = 0;
    for (const e of edges) {
        // Normalize existing boolean river flag into string water if present
        if (e.river === true && !e.water) {
            e.water = 'river';
            delete e.river;
            converted++;
        }
    }

    // Tokens for corridors (slug fragments or zh)
    const canalTokens = [
        // Grand Canal Jiangnan: Suzhou-Pingjiang, Changzhou, Zhenjiang, Yangzhou, Taizhou, Tongzhou, Haizhou
        'suzhou', 'pingjiang', 'changzhou', 'zhenjiang', 'yangzhou', 'taizhou', 'tongzhou', 'haizhou',
        // Hangzhou–Shaoxing–Yuezhou (越州) – Mingzhou (宁波)
        'hangzhou', 'shaoxing', 'yuezhou', 'mingzhou', 'ningbo'
    ];
    const coastTokens = [
        // Sea/coast: Fuzhou–Quanzhou–Guangzhou, Changguo–Dinghai–Mingzhou
        'fuzhou', 'quanzhou', 'guangzhou', 'changguo', 'dinghai', 'ningbo', 'mingzhou', '定海', '昌國'
    ];

    // Explicit lake pairs (unordered) by id slug
    const lakePairs = new Set([
        'jiujiang|nanchang' // via Poyang Lake (Gan river into lake then Yangtze)
    ]);

    function classifyWater(e) {
        const a = (e.from || '').toString();
        const b = (e.to || '').toString();
        if (!e.water) return;
        // Lake overrides
        if (lakePairs.has(pairKey(a, b))) {
            if (e.water !== 'lake') { e.water = 'lake'; retyped++; }
            return;
        }
        // Coast if both endpoints are coastal tokens (heuristic)
        if (idMatches(a, coastTokens) && idMatches(b, coastTokens)) {
            if (e.water !== 'coast') { e.water = 'coast'; retyped++; }
            return;
        }
        // Canal if both endpoints are on canal corridor tokens
        if (idMatches(a, canalTokens) && idMatches(b, canalTokens)) {
            if (e.water !== 'canal') { e.water = 'canal'; retyped++; }
            return;
        }
        // Otherwise keep as river
        if (e.water !== 'river') { e.water = 'river'; retyped++; }
    }

    for (const e of edges) classifyWater(e);

    fs.writeFileSync(CONN_PATH, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Classified water edges. Converted ${converted} legacy flags; retyped ${retyped} edges.`);
}

main();


