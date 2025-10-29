#!/usr/bin/env node
// Count how many events in data/events-1127-1142.jsonl correspond to each city.
// Uses aliases from data/cities.json and matches places.primary/other.name_zh.
// Usage: node scripts/countEventsPerCity.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const EVENTS_PATH = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');
const AS_JSON = process.argv.includes('--json');

function stripSuffix(name) {
  if (!name) return name;
  // Remove whitespace and parentheses content (Chinese and ASCII)
  let t = name.replace(/[\s\u00A0]+/g, '');
  t = t.replace(/[（(][^）)]*[）)]/g, '');
  // Remove common administrative suffixes when present
  return t.replace(/(府|軍|縣城|縣|州|鎮|城)$/u, '');
}

function buildAliasMap(cities) {
  const aliasToId = new Map();
  const idToMeta = new Map();
  for (const c of cities) {
    idToMeta.set(c.id, { zh: c.zh, pinyin: c.pinyin });
    const names = new Set([c.zh, c.name_zh, ...(Array.isArray(c.aliases) ? c.aliases : [])].filter(Boolean));
    for (const raw of names) {
      const a = raw.trim();
      const s = stripSuffix(a);
      aliasToId.set(a, c.id);
      if (s && s !== a) aliasToId.set(s, c.id);
    }
  }
  return { aliasToId, idToMeta };
}

async function countEventsPerCity() {
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  const { aliasToId, idToMeta } = buildAliasMap(cities);
  const counts = new Map(cities.map(c => [c.id, 0]));
  let totalEvents = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(EVENTS_PATH, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    const p = obj.places || {};
    const primary = p.primary && p.primary.name_zh ? [p.primary.name_zh] : [];
    const other = Array.isArray(p.other) ? p.other.map(x => x && x.name_zh).filter(Boolean) : [];
    const names = [...primary, ...other];
    const eventCityIds = new Set();
    for (const nm of names) {
      const key = stripSuffix(nm);
      const id = aliasToId.get(nm) || aliasToId.get(key);
      if (id) eventCityIds.add(id);
    }
    // Count this event for all matched cities (unique per event)
    if (eventCityIds.size > 0) totalEvents++;
    for (const id of eventCityIds) counts.set(id, (counts.get(id) || 0) + 1);
  }

  // Prepare output
  const rows = Array.from(counts.entries())
    .map(([id, count]) => ({ id, zh: idToMeta.get(id)?.zh || '', pinyin: idToMeta.get(id)?.pinyin || '', count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  if (AS_JSON) {
    console.log(JSON.stringify({ totalEvents, cities: rows }, null, 2));
  } else {
    console.log(`Total events with any mapped city: ${totalEvents}`);
    for (const r of rows) {
      console.log(`${r.id.padEnd(12)} ${String(r.count).padStart(3)}  ${r.zh} (${r.pinyin})`);
    }
  }
}

await countEventsPerCity();


