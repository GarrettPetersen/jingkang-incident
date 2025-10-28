#!/usr/bin/env node
// List cities that have no connections in data/connections.json

import fs from 'node:fs';
import path from 'node:path';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');

function main() {
    const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
    const conns = JSON.parse(fs.readFileSync(CONN_PATH, 'utf8'));

    const nameSet = new Set(cities.map(c => c.name_zh));
    const deg = new Map();
    for (const name of nameSet) deg.set(name, 0);

    for (const e of conns.edges || []) {
        if (!nameSet.has(e.from) || !nameSet.has(e.to)) continue;
        deg.set(e.from, (deg.get(e.from) || 0) + 1);
        deg.set(e.to, (deg.get(e.to) || 0) + 1);
    }

    const isolated = cities.filter(c => (deg.get(c.name_zh) || 0) === 0);
    if (isolated.length === 0) {
        console.log('All cities have at least one connection.');
        return;
    }
    console.log(`Unconnected cities (${isolated.length}):`);
    for (const c of isolated) {
        console.log(`- ${c.name_zh} (${c.type})`);
    }
}

main();
