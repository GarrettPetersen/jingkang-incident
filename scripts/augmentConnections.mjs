#!/usr/bin/env node
// Add connections for previously unconnected cities based on historical adjacency.

import fs from 'node:fs';
import path from 'node:path';

const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');
const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');

function twoWay(from, to, surface, river = false) {
    const a = { from, to }; const b = { from: to, to: from };
    if (river) { a.river = true; b.river = true; }
    if (surface) { a.surface = surface; b.surface = surface; }
    return [a, b];
}

function main() {
    const conns = JSON.parse(fs.readFileSync(CONN_PATH, 'utf8'));
    const cities = new Set(JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8')).map(c => c.name_zh));
    const edges = Array.isArray(conns.edges) ? conns.edges : [];
    const sig = new Set(edges.map(e => `${e.from}|${e.to}|${e.river ? 'river' : e.surface || 'land'}`));

    // Planned augmentations
    const add = [
        // Capitals / meta entries
        ...twoWay('南京路', '汴京', 'road', false),
        ...twoWay('行在', '臨安府', 'road', false),
        ...twoWay('上京', '燕京', 'path', false),
        ...twoWay('上京', '五國城', 'path', false),

        // Zhejiang / coast
        ...twoWay('臨平', '杭州', 'road', false),
        ...twoWay('昌國縣', '定海縣', undefined, true),
        ...twoWay('昌國縣', '明州', undefined, true),
        ...twoWay('婺州', '越州', 'road', false),
        ...twoWay('紹興府', '越州', 'road', false),

        // Around Kaifeng / Henan
        ...twoWay('顯寧寺', '汴京', 'road', false),
        ...twoWay('柳子鎮', '宿州', 'path', false),
        ...twoWay('劉冷莊', '郾城', 'path', false),
        ...twoWay('靜安鎮', '建康府', 'road', false),

        // Huai / North Jiangsu
        ...twoWay('沐陽', '楚州', 'road', false),
        ...twoWay('泇口鎮', '泗州', 'road', false),
        ...twoWay('大儀', '揚州', 'road', false),

        // Lower Yangzi vicinity
        ...twoWay('金山', '鎮江府', undefined, true),
        ...twoWay('採石、宣化渡', '建康府', undefined, true),
        ...twoWay('採石、宣化渡', '太平州', undefined, true),
        ...twoWay('江陰軍', '平江府', 'road', false),
        ...twoWay('六合', '建康府', 'road', false),

        // Anhui / Hefei
        ...twoWay('柘皋', '廬州', 'road', false),
        ...twoWay('廬州', '太平州', 'road', false),
        ...twoWay('廬州', '建康府', 'road', false),

        // Jiangxi / Hunan
        ...twoWay('武陵', '鼎州', 'road', false),

        // Fujian interior
        ...twoWay('建州', '福州', 'path', false),

        // Hebei / North China Plain
        ...twoWay('磁州', '邢州', 'road', false),
        ...twoWay('祁州', '趙州', 'road', false),
        ...twoWay('平州', '燕京', 'path', false),

        // Shandong coast
        ...twoWay('密州', '海州', 'road', false),

        // Shaanxi / Long-You
        ...twoWay('興州', '興元府', 'path', false),
        ...twoWay('興州', '鳳州', 'path', false),

        // Lingnan
        ...twoWay('邕州', '廣州', 'path', false),

        // Misc
        ...twoWay('江寧府', '建康府', 'road', false),
        ...twoWay('河池', '利州', 'path', false),
    ];

    let added = 0, skipped = 0;
    for (const e of add) {
        if (!cities.has(e.from) || !cities.has(e.to)) { skipped++; continue; }
        const s = `${e.from}|${e.to}|${e.river ? 'river' : e.surface || 'land'}`;
        if (sig.has(s)) { continue; }
        edges.push(e);
        sig.add(s);
        added++;
    }

    fs.writeFileSync(CONN_PATH, JSON.stringify({ edges }, null, 2), 'utf8');
    console.log(`Augmented connections: added ${added} directed edges (skipped ${skipped}).`);
}

main();


