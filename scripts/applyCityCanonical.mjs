#!/usr/bin/env node
// Apply canonical city names to events based on data/city_duplicates.json suggestions.
// Creates a backup of events JSONL, rewrites places.primary/other name_zh when mapped.

import fs from 'node:fs';
import path from 'node:path';

const DUP_PATH = path.resolve(process.cwd(), 'data/city_duplicates.json');
const EVENTS_PATH = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');

function loadDuplicateReport() {
    if (!fs.existsSync(DUP_PATH)) {
        throw new Error(`Duplicate report not found: ${DUP_PATH}`);
    }
    const report = JSON.parse(fs.readFileSync(DUP_PATH, 'utf8'));
    return report?.duplicate_clusters || [];
}

function buildNameMapping(dupClusters) {
    // Map each non-canonical member name_zh to canonical name_zh
    const nameMap = new Map();
    for (const cluster of dupClusters) {
        const canon = cluster?.suggested_canonical;
        const merges = cluster?.suggested_merge || [];
        if (!canon || !canon.name_zh) continue;
        const canonicalName = canon.name_zh;
        for (const m of merges) {
            if (!m || !m.name_zh) continue;
            // Avoid mapping a name that is already equal
            if (m.name_zh !== canonicalName) {
                nameMap.set(m.name_zh, canonicalName);
            }
        }
    }
    return nameMap;
}

function applyMappingToPlace(place, nameMap) {
    if (!place || typeof place !== 'object') return false;
    const n = (place.name_zh || '').toString().trim();
    if (!n) return false;
    const mapped = nameMap.get(n);
    if (mapped) {
        place.name_zh = mapped;
        return true;
    }
    return false;
}

function main() {
    const clusters = loadDuplicateReport();
    const nameMap = buildNameMapping(clusters);
    if (nameMap.size === 0) {
        console.log('No mappings to apply.');
        return;
    }

    if (!fs.existsSync(EVENTS_PATH)) {
        throw new Error(`Events file not found: ${EVENTS_PATH}`);
    }

    const src = fs.readFileSync(EVENTS_PATH, 'utf8');
    const lines = src.split('\n');
    const outLines = [];
    let changedEvents = 0;
    let placeRenames = 0;

    for (const line of lines) {
        if (!line.trim()) { outLines.push(line); continue; }
        let evt;
        try {
            evt = JSON.parse(line);
        } catch (e) {
            // Keep malformed as-is
            outLines.push(line);
            continue;
        }
        let changed = false;
        const places = evt.places || {};
        if (places.primary && typeof places.primary === 'object') {
            if (applyMappingToPlace(places.primary, nameMap)) { changed = true; placeRenames++; }
        }
        if (Array.isArray(places.other)) {
            for (const pl of places.other) {
                if (applyMappingToPlace(pl, nameMap)) { changed = true; placeRenames++; }
            }
        }
        if (changed) changedEvents++;
        outLines.push(JSON.stringify(evt));
    }

    // Backup then write
    const backup = EVENTS_PATH + '.bak';
    fs.writeFileSync(backup, src, 'utf8');
    fs.writeFileSync(EVENTS_PATH, outLines.join('\n'), 'utf8');
    console.log(`Applied ${nameMap.size} canonical mappings: ${placeRenames} place renames across ${changedEvents} events.`);
    console.log(`Backup written: ${backup}`);
}

main();


