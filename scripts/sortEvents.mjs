#!/usr/bin/env node
// Sort and clean JSONL events by date.iso_start then id; normalize key ordering.
import fs from 'node:fs';
import path from 'node:path';

const INPUT = process.argv[2] || path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');
const OUT_FLAG_IDX = process.argv.indexOf('--out');
const OUT = OUT_FLAG_IDX > -1 ? process.argv[OUT_FLAG_IDX + 1] : null;
const IN_PLACE = process.argv.includes('--in-place');

if (!fs.existsSync(INPUT)) {
    console.error(`Input not found: ${INPUT}`);
    process.exit(1);
}

function normalizeIsoStart(iso) {
    if (typeof iso !== 'string' || !iso) return '9999-12-31';
    if (/^\d{4}$/.test(iso)) return `${iso}-01-01`;
    if (/^\d{4}-\d{2}$/.test(iso)) return `${iso}-01`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    return '9999-12-31';
}

function trimStringsDeep(value) {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(trimStringsDeep);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = trimStringsDeep(v);
        return out;
    }
    return value;
}

const KEY_ORDER = [
    'id', 'work', 'chapter_title', 'url', 'date', 'places', 'actors',
    'categories', 'tags', 'summary_en', 'excerpt_zh', 'sources',
    'design_notes', 'confidence', 'review_status', 'duplicates'
];

function orderChapterTitle(ct) {
    if (!ct || typeof ct !== 'object') return ct;
    const o = {};
    for (const k of ['zh', 'en']) if (ct[k] !== undefined) o[k] = ct[k];
    // include any other keys deterministically
    for (const k of Object.keys(ct).sort()) if (!(k in o)) o[k] = ct[k];
    return o;
}

function orderPlaces(places) {
    if (!places || typeof places !== 'object') return places;
    const o = {};
    if (places.primary) o.primary = places.primary;
    if (Array.isArray(places.other)) o.other = places.other;
    for (const k of Object.keys(places).sort()) if (!(k in o)) o[k] = places[k];
    return o;
}

function canonicalize(ev) {
    const e = trimStringsDeep(ev);
    if (e.chapter_title) e.chapter_title = orderChapterTitle(e.chapter_title);
    if (e.places) e.places = orderPlaces(e.places);
    // de-dupe simple arrays
    for (const a of ['categories', 'tags']) {
        if (Array.isArray(e[a])) e[a] = Array.from(new Set(e[a].map(String)));
    }
    // ensure arrays are arrays
    if (e.sources && !Array.isArray(e.sources)) e.sources = [e.sources];
    if (e.actors && !Array.isArray(e.actors)) e.actors = [e.actors];

    const out = {};
    for (const k of KEY_ORDER) if (e[k] !== undefined) out[k] = e[k];
    // append any extra keys deterministically
    for (const k of Object.keys(e).sort()) if (!(k in out)) out[k] = e[k];
    return out;
}

function sortKey(ev) {
    const iso = normalizeIsoStart(ev?.date?.iso_start);
    return `${iso}~${ev.id || ''}`;
}

const raw = fs.readFileSync(INPUT, 'utf8');
const lines = raw.split(/\n+/).filter(Boolean);

const seen = new Set();
const events = [];
let skipped = 0;
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
        const obj = JSON.parse(line);
        if (obj && obj.id) {
            if (seen.has(obj.id)) {
                skipped++;
                continue;
            }
            seen.add(obj.id);
        }
        events.push(obj);
    } catch (err) {
        console.error(`Parse error on line ${i + 1}: ${err.message}`);
    }
}

events.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

const cleaned = events.map(canonicalize);
const output = cleaned.map(e => JSON.stringify(e)).join('\n') + '\n';

const target = IN_PLACE ? INPUT : (OUT || INPUT);
if (!IN_PLACE && OUT == null) {
    // default: print to stdout
    process.stdout.write(output);
} else {
    if (IN_PLACE && !OUT) {
        // write a backup
        fs.writeFileSync(`${INPUT}.bak`, raw);
    }
    fs.writeFileSync(target, output);
    console.error(`Wrote ${cleaned.length} events to ${target}${skipped ? ` (skipped ${skipped} duplicate id(s))` : ''}.`);
}


