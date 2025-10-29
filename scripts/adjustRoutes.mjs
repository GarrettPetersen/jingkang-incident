#!/usr/bin/env node
// Adjust specific connections for geographic realism:
// - Drop yangzhou<->cangzhou direct; add yangzhou->huaiyin->haizhou->cangzhou (roads)
// - Drop taiyuan<->yanjing direct; add taiyuan->zhaozhou (path), zhaozhou->yanjing (road)

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

    // Drop entire pairs regardless of type
    const dropPairs = new Set([
        'yangzhou|cangzhou', 'cangzhou|yangzhou',
        'taiyuan|yanjing', 'yanjing|taiyuan',
        // Simplify Lower Yangtze rat’s nest
        'yangzhou|suzhou-js', 'suzhou-js|yangzhou',
        'suzhou-js|taizhou', 'taizhou|suzhou-js',
        // Reduce Hangzhou–Shaoxing–Ningbo triangle
        'hangzhou|ningbo', 'ningbo|hangzhou',
        // Respect stopover: Hangzhou→Suzhou→Zhenjiang→Yangzhou (drop direct Hangzhou↔Yangzhou)
        'hangzhou|yangzhou', 'yangzhou|hangzhou',
        // Clean up Shaoxing/Ningbo to Jianzhou long diagonals
        'shaoxing|jianzhou-fj', 'jianzhou-fj|shaoxing',
        'ningbo|jianzhou-fj', 'jianzhou-fj|ningbo',
        // Remove Zhenjiang↔Huaiyin diagonal (use Zhenjiang↔Yangzhou↔Huaiyin)
        'zhenjiang|huaiyin', 'huaiyin|zhenjiang',
        // Trim Taizhou↔Huaiyin diagonal; route via Yangzhou or Haizhou
        'taizhou|huaiyin', 'huaiyin|taizhou',
    ]);

    // For selected pairs, drop only land edges (keep water): zhenjiang<->yangzhou
    const dropLandOnlyPairs = new Set([
        'zhenjiang|yangzhou', 'yangzhou|zhenjiang',
        // Simplify Taizhou spokes: keep canals only
        'yangzhou|taizhou', 'taizhou|yangzhou',
        'haizhou|taizhou', 'taizhou|haizhou',
        // Opposite Yangtze banks: keep water-only
        'jiujiang|ezhou', 'ezhou|jiujiang',
        'jiujiang|yueyang', 'yueyang|jiujiang',
        // Luzhou (Hefei) should NOT have land to south-bank Nanjing
        'hefei|nanjing', 'nanjing|hefei',
    ]);

    const before = edges.length;
    edges = edges.filter(e => {
        // Drop all self-edges
        if (e.from === e.to) return false;
        const pair = `${e.from}|${e.to}`;
        if (dropPairs.has(pair)) return false;
        if (dropLandOnlyPairs.has(pair)) {
            // Keep if it's water; drop if it's a land surface
            if (e.water) return true;
            if (e.surface) return false;
        }
        // Drop only canal for Zhenjiang↔Yangzhou (keep river crossing)
        if ((pair === 'zhenjiang|yangzhou' || pair === 'yangzhou|zhenjiang') && e.water === 'canal') {
            return false;
        }
        // Pair-specific land type cleanup
        // Hangzhou↔Shaoxing: keep path (and canal), drop road
        if ((pair === 'hangzhou|shaoxing' || pair === 'shaoxing|hangzhou') && e.surface === 'road') {
            return false;
        }
        // Nanjing↔Hefei handled by dropLandOnlyPairs (no land allowed)
        return true;
    });
    const removed = before - edges.length;

    // Add replacements
    const add = [
        ...twoWay('yangzhou', 'huaiyin', 'road'),
        ...twoWay('huaiyin', 'haizhou', 'road'),
        ...twoWay('haizhou', 'cangzhou', 'road'),
        ...twoWay('taiyuan', 'zhaozhou', 'path'),
        ...twoWay('zhaozhou', 'yanjing', 'road'),
        // Add trunk canal between Zhenjiang and Suzhou
        { from: 'zhenjiang', to: 'suzhou-js', water: 'canal' },
        { from: 'suzhou-js', to: 'zhenjiang', water: 'canal' },
        // Ensure Suzhou has a trunk canal to Hangzhou (via Taihu/Grand Canal region)
        { from: 'hangzhou', to: 'suzhou-js', water: 'canal' },
        { from: 'suzhou-js', to: 'hangzhou', water: 'canal' },
        // Add overland road between Suzhou and Nanjing to provide a land route
        { from: 'suzhou-js', to: 'nanjing', surface: 'road' },
        { from: 'nanjing', to: 'suzhou-js', surface: 'road' },
        // Southern basin: prefer paths over roads
        { from: 'yueyang', to: 'tanzhou', surface: 'path' },
        { from: 'tanzhou', to: 'yueyang', surface: 'path' },
        // Extend Yangtze inland using existing cities
        { from: 'ezhou', to: 'yueyang', water: 'river' },
        { from: 'yueyang', to: 'ezhou', water: 'river' },
        // Han River tributary as inland water corridor
        { from: 'ezhou', to: 'xiangyang', water: 'river' },
        { from: 'xiangyang', to: 'ezhou', water: 'river' },
        // Restore south-bank land corridor
        { from: 'nanjing', to: 'zhenjiang', surface: 'road' },
        { from: 'zhenjiang', to: 'nanjing', surface: 'road' },
        // Provide north-bank land linkage for Hefei and a boat-only crossing
        { from: 'hefei', to: 'huaiyin', surface: 'path' },
        { from: 'huaiyin', to: 'hefei', surface: 'path' },
        { from: 'hefei', to: 'nanjing', water: 'river' },
        { from: 'nanjing', to: 'hefei', water: 'river' },
    ];
    const sig = new Set(edges.map(e => `${e.from}|${e.to}|${e.surface || ''}|${e.water || ''}`));
    let added = 0;
    for (const e of add) {
        const key = `${e.from}|${e.to}|${e.surface || ''}|${e.water || ''}`;
        if (sig.has(key)) continue;
        edges.push(e); sig.add(key); added++;
    }

    fs.writeFileSync(CONN, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Adjusted routes: removed ${removed}, added ${added}.`);
}

main();


