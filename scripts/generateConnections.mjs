#!/usr/bin/env node
// Generate an initial adjacency (connections) file using historical corridors.
// Edge schema: { from, to, surface: 'road'|'path', river: boolean }
// Note: river=true indicates the edge follows/needs water crossing (boat/bridge).

import fs from 'node:fs';
import path from 'node:path';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const OUT_PATH = path.resolve(process.cwd(), 'data/connections.json');

function loadCities() {
    const arr = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
    const names = new Set(arr.map(c => c.name_zh));
    return { arr, names };
}

function edge(from, to, surface, river = false) {
    return { from, to, surface, river };
}

function twoWay(from, to, surface, river = false) {
    return [edge(from, to, surface, river), edge(to, from, surface, river)];
}

function main() {
    if (!fs.existsSync(CITIES_PATH)) {
        console.error('Missing cities.json');
        process.exit(1);
    }
    const { names } = loadCities();

    const planned = [
        // Central Plains & Kaifeng corridor
        ...twoWay('汴京', '朱仙鎮', 'road', false),
        ...twoWay('汴京', '汝州', 'road', false),
        ...twoWay('汝州', '順昌', 'road', false),
        ...twoWay('順昌', '宿州', 'road', false),
        ...twoWay('宿州', '泗州', 'road', true),
        ...twoWay('泗州', '楚州', 'road', true),
        ...twoWay('楚州', '揚州', 'road', true),
        ...twoWay('汴京', '穎昌', 'road', false),
        ...twoWay('穎昌', '郾城', 'road', false),
        ...twoWay('郾城', '朱仙鎮', 'road', false),
        ...twoWay('汴京', '應天府', 'road', false),
        ...twoWay('應天府', '宿州', 'road', false),

        // Lower Yangzi & Grand Canal
        ...twoWay('揚州', '鎮江府', 'road', true),
        ...twoWay('鎮江府', '建康府', 'road', true),
        ...twoWay('鎮江府', '平江府', 'road', true),
        ...twoWay('平江府', '常州', 'road', true),
        ...twoWay('常州', '揚州', 'road', true),
        ...twoWay('平江府', '杭州', 'road', true),
        ...twoWay('杭州', '越州', 'road', true),
        ...twoWay('越州', '明州', 'path', false),
        ...twoWay('明州', '定海縣', 'road', false),
        ...twoWay('杭州', '臨安府', 'road', false),
        ...twoWay('建康府', '太平州', 'road', false),
        ...twoWay('建康府', '宣州', 'road', false),
        ...twoWay('建康府', '真州', 'road', true),

        // Huai–Sea corridor
        ...twoWay('揚州', '泰州', 'road', true),
        ...twoWay('泰州', '通州', 'road', true),
        ...twoWay('通州', '海州', 'road', true),
        ...twoWay('海州', '楚州', 'road', true),

        // Middle Yangzi & Han River
        ...twoWay('襄陽府', '郢州', 'road', true),
        ...twoWay('郢州', '鄂州', 'road', true),
        ...twoWay('鄂州', '江州', 'road', true),
        ...twoWay('江州', '饒州', 'road', true),

        // Southeast coast
        ...twoWay('福州', '泉州', 'road', true),
        ...twoWay('泉州', '廣州', 'path', true),

        // Northwest (Qin–Long corridor)
        ...twoWay('利州', '興元府', 'path', false),
        ...twoWay('興元府', '鳳州', 'path', false),
        ...twoWay('鳳州', '秦州', 'path', false),
        ...twoWay('秦州', '隴州', 'path', false),
        ...twoWay('承州', '富平', 'path', false),
        ...twoWay('富平', '秦州', 'path', false),

        // North China Plain & Hebei
        ...twoWay('燕京', '燕山府', 'road', false),
        ...twoWay('燕山府', '寶坻', 'road', false),
        ...twoWay('寶坻', '滄州', 'road', false),
        ...twoWay('滄州', '大名府', 'road', false),
        ...twoWay('大名府', '洺州', 'road', false),
        ...twoWay('洺州', '邢州', 'road', false),
        ...twoWay('邢州', '趙州', 'road', false),
        ...twoWay('趙州', '相州', 'road', false),

        // Taihang passes toward Taiyuan (mountain paths)
        ...twoWay('相州', '太原府', 'path', false),
        ...twoWay('邢州', '太原府', 'path', false),

        // Hunan / Jiangxi interior
        ...twoWay('潭州', '長沙', 'road', false),
        ...twoWay('長沙', '鼎州', 'road', false),
        ...twoWay('饒州', '筠州', 'road', false),
    ];

    // Validate endpoints exist; skip unknowns
    const edges = [];
    let skipped = 0;
    for (const e of planned) {
        if (!names.has(e.from) || !names.has(e.to)) {
            skipped++;
            continue;
        }
        edges.push(e);
    }

    const out = { edges };
    const outDir = path.dirname(OUT_PATH);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
    console.log(`Wrote ${edges.length} edges to ${OUT_PATH}. Skipped ${skipped} planned edges not present in cities.`);
}

main();


