#!/usr/bin/env node
// Count events per city by mapping event place names to canonical city ids.
// Usage: node scripts/countEventsPerCity.mjs [--top N]

import fs from 'node:fs';
import path from 'node:path';

const EVENTS_PATH = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');
const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');

function buildAliasMap(cities) {
  const aliasToId = new Map();
  for (const c of cities) {
    if (!c || !c.id) continue;
    aliasToId.set(c.id, c.id);
    if (c.zh) aliasToId.set(String(c.zh).trim(), c.id);
    if (c.name_zh) aliasToId.set(String(c.name_zh).trim(), c.id);
    if (c.name_pinyin) aliasToId.set(String(c.name_pinyin).trim(), c.id);
    if (Array.isArray(c.aliases)) {
      for (const a of c.aliases) {
        if (a && String(a).trim()) aliasToId.set(String(a).trim(), c.id);
      }
    }
  }
  return aliasToId;
}

function namesFromPlace(p) {
  const out = [];
  if (!p) return out;
  if (typeof p === 'string') { out.push(p); return out; }
  if (p.name_zh) out.push(String(p.name_zh).trim());
  if (p.name_pinyin) out.push(String(p.name_pinyin).trim());
  if (p.zh) out.push(String(p.zh).trim());
  if (p.pinyin) out.push(String(p.pinyin).trim());
  if (p.id) out.push(String(p.id).trim());
  return out.filter(Boolean);
}

function* iterateEventPlaces(evt) {
  if (!evt || !evt.places) return;
  const pl = evt.places;
  if (pl.primary) yield pl.primary;
  if (Array.isArray(pl.other)) {
    for (const o of pl.other) yield o;
  }
}

function main() {
  if (!fs.existsSync(EVENTS_PATH)) {
    console.error(`Missing events file at ${EVENTS_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(CITIES_PATH)) {
    console.error(`Missing cities file at ${CITIES_PATH}`);
    process.exit(1);
  }

  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  const aliasToId = buildAliasMap(cities);
  const idToLabel = new Map(cities.map(c => [c.id, (c.name_pinyin && c.name_pinyin.trim()) ? c.name_pinyin.trim() : (c.zh || c.id)]));

  const lines = fs.readFileSync(EVENTS_PATH, 'utf8').split(/\n+/).filter(Boolean);
  const counts = new Map();
  let totalEvents = 0;

  for (const line of lines) {
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    totalEvents++;
    const seenIds = new Set();
    for (const p of iterateEventPlaces(evt)) {
      const names = namesFromPlace(p);
      for (const n of names) {
        const id = aliasToId.get(n);
        if (!id) continue;
        if (seenIds.has(id)) continue; // count once per event per city
        seenIds.add(id);
        counts.set(id, (counts.get(id) || 0) + 1);
        break;
      }
    }
  }

  // Sort by count desc, then label asc
  const rows = Array.from(counts.entries()).map(([id, cnt]) => ({ id, label: idToLabel.get(id) || id, count: cnt }));
  rows.sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));

  const topIdx = process.argv.indexOf('--top');
  let top = undefined;
  if (topIdx !== -1 && process.argv[topIdx + 1]) {
    const n = parseInt(process.argv[topIdx + 1], 10);
    if (!isNaN(n) && n > 0) top = n;
  }

  const list = top ? rows.slice(0, top) : rows;
  const AS_JSON = process.argv.includes('--json');
  if (AS_JSON) {
    const out = { total_events: totalEvents, distinct_cities: rows.length, counts: list };
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('Total events: ' + totalEvents);
    console.log('Cities with events: ' + rows.length);
    for (const r of list) {
      console.log(r.label + ': ' + r.count);
    }
  }
}

main();


