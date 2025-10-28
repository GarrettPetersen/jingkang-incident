#!/usr/bin/env node
// Extract city-like locations from events JSONL into a cities.json file.
// Only include settlement-scale places (city/prefecture/county/town/village/port/capital/etc.).
// Exclude broad regions, routes, rivers/waterways, courts, fronts, corridors, etc.

import fs from 'node:fs';
import path from 'node:path';

const INPUT_DEFAULT = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');
const OUT_DEFAULT = path.resolve(process.cwd(), 'data/cities.json');

const args = process.argv.slice(2);
const inIdx = args.indexOf('--in');
const outIdx = args.indexOf('--out');
const INPUT = inIdx > -1 ? path.resolve(process.cwd(), args[inIdx + 1]) : INPUT_DEFAULT;
const OUTPUT = outIdx > -1 ? path.resolve(process.cwd(), args[outIdx + 1]) : OUT_DEFAULT;

// Types that count as settlements for the game map
const allowedSettlementTypes = new Set([
    'capital',
    'metropolis',
    'city',
    'prefecture',
    'prefecture-capital',
    'county',
    'town',
    'village',
    'port',
    'market',
    'gate',
    'fort',
    'fortress',
    'castle',
    'garrison',
]);

// Types to skip (not settlements)
const excludedTypes = new Set([
    'region',
    'route',
    'province',
    'front',
    'corridor',
    'theater',
    'court',
    'river',
    'waterway',
    'lake',
    'sea',
    'mountain',
    'island',
]);

function isSettlement(place) {
    if (!place || typeof place !== 'object') return false;
    const t = (place.type || '').toString().trim().toLowerCase();
    if (!t) return false;
    if (excludedTypes.has(t)) return false;
    if (allowedSettlementTypes.has(t)) return true;
    // If type is unknown, be conservative and exclude
    return false;
}

function normalizeName(s) {
    return (s || '').toString().trim();
}

function splitParentheticalZh(nameZh) {
    const original = normalizeName(nameZh);
    if (!original) return { base: '', qualifier: '', original };
    const base = original.replace(/[（(].*?[）)]/g, '').trim();
    const m = original.match(/[（(](.*?)[）)]/);
    const qualifier = m ? m[1].trim() : '';
    return { base, qualifier, original };
}

function keyFor(place) {
    const { base: zh } = splitParentheticalZh(place.name_zh);
    const t = (place.type || '').toString().trim().toLowerCase();
    return `${zh}|${t}`;
}

function collectPlacesFromEvent(evt) {
    const found = [];
    const p = evt?.places || {};
    const primary = p.primary && typeof p.primary === 'object' ? [p.primary] : [];
    const other = Array.isArray(p.other) ? p.other.filter(x => x && typeof x === 'object') : [];
    for (const pl of [...primary, ...other]) {
        if (!pl) continue;
        if (!normalizeName(pl.name_zh)) continue;
        if (isSettlement(pl)) {
            found.push(pl);
        }
    }
    return found;
}

function main() {
    if (!fs.existsSync(INPUT)) {
        console.error(`Input not found: ${INPUT}`);
        process.exit(1);
    }

    const lines = fs.readFileSync(INPUT, 'utf8').split('\n').filter(Boolean);
    const keyToCity = new Map();

    let totalEvents = 0;
    let totalMentions = 0;

    for (const line of lines) {
        let evt;
        try {
            evt = JSON.parse(line);
        } catch (e) {
            // Skip malformed lines
            continue;
        }
        totalEvents++;
        const places = collectPlacesFromEvent(evt);
        for (const pl of places) {
            const k = keyFor(pl);
            if (!k) continue;
            totalMentions++;
            const existing = keyToCity.get(k);
            const { base, qualifier, original } = splitParentheticalZh(pl.name_zh);
            const rec = existing || {
                name_zh: base,
                name_pinyin: normalizeName(pl.name_pinyin || pl.name_en_or_pinyin || ''),
                type: (pl.type || '').toString().trim().toLowerCase(),
                qualifier_zh: qualifier || undefined,
                original_name_zh: original !== base ? original : undefined,
                referenced_by: new Set(),
            };
            if (evt.id) rec.referenced_by.add(evt.id);
            keyToCity.set(k, rec);
        }
    }

    const cities = Array.from(keyToCity.values()).map(c => ({
        name_zh: c.name_zh,
        name_pinyin: c.name_pinyin,
        type: c.type,
        qualifier_zh: c.qualifier_zh,
        original_name_zh: c.original_name_zh,
        referenced_by: Array.from(c.referenced_by).sort(),
    }));

    // Sort for stability: by type, then pinyin, then zh
    cities.sort((a, b) => {
        const t = (a.type || '').localeCompare(b.type || '');
        if (t !== 0) return t;
        const p = (a.name_pinyin || '').localeCompare(b.name_pinyin || '');
        if (p !== 0) return p;
        return (a.name_zh || '').localeCompare(b.name_zh || '');
    });

    // Ensure output directory exists
    const outDir = path.dirname(OUTPUT);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(cities, null, 2), 'utf8');

    console.log(`Parsed ${totalEvents} events; found ${cities.length} settlement entries from ${totalMentions} mentions.`);
    console.log(`Wrote ${OUTPUT}`);
}

main();


