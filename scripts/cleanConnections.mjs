#!/usr/bin/env node
// Remove connections whose endpoints are not present in data/cities.json

import fs from 'node:fs';
import path from 'node:path';

const CITIES = path.resolve(process.cwd(), 'data/cities.json');
const CONNS = path.resolve(process.cwd(), 'data/connections.json');

function main() {
    const cities = JSON.parse(fs.readFileSync(CITIES, 'utf8'));
    const ids = new Set(cities.map(c => c.id));
    const data = JSON.parse(fs.readFileSync(CONNS, 'utf8'));
    const edges = Array.isArray(data.edges) ? data.edges : [];

    const before = edges.length;
    const kept = edges.filter(e => ids.has(e.from) && ids.has(e.to));
    const dropped = before - kept.length;

    fs.writeFileSync(CONNS, JSON.stringify({ edges: kept }, null, 2), 'utf8');
    console.log(`Cleaned connections: kept ${kept.length}, dropped ${dropped}.`);
}

main();


