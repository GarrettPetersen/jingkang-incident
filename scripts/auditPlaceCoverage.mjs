#!/usr/bin/env node
// Audit coverage of place names in events against city aliases.
// Reports unmatched Chinese place names and top matches per city.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const EVENTS_PATH = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');

function stripSuffix(name) {
  if (!name) return name;
  let t = name.replace(/[\s\u00A0]+/g, '');
  t = t.replace(/[（(][^）)]*[）)]/g, '');
  return t.replace(/(府|軍|縣城|縣|州|鎮|城)$/u, '');
}

function buildAliasMap(cities) {
  const aliasToId = new Map();
  for (const c of cities) {
    const names = new Set([c.zh, c.name_zh, ...(Array.isArray(c.aliases) ? c.aliases : [])].filter(Boolean));
    for (const raw of names) {
      const a = raw.trim();
      const s = stripSuffix(a);
      aliasToId.set(a, c.id);
      if (s && s !== a) aliasToId.set(s, c.id);
    }
  }
  return aliasToId;
}

async function audit() {
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  const aliasToId = buildAliasMap(cities);
  const known = new Set(aliasToId.keys());

  const unmatchedCounts = new Map();
  const matchedCounts = new Map(cities.map(c => [c.id, 0]));

  const rl = readline.createInterface({ input: fs.createReadStream(EVENTS_PATH, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let obj; try { obj = JSON.parse(t); } catch { continue; }
    const p = obj.places || {};
    const primary = p.primary && p.primary.name_zh ? [p.primary.name_zh] : [];
    const other = Array.isArray(p.other) ? p.other.map(x => x && x.name_zh).filter(Boolean) : [];
    const names = [...primary, ...other];
    const seenIds = new Set();
    for (const nm of names) {
      const a = nm.trim();
      const s = stripSuffix(a);
      const id = aliasToId.get(a) || aliasToId.get(s);
      if (id) { if (!seenIds.has(id)) matchedCounts.set(id, matchedCounts.get(id) + 1); seenIds.add(id); }
      else { unmatchedCounts.set(a, (unmatchedCounts.get(a) || 0) + 1); }
    }
  }

  const unmatched = Array.from(unmatchedCounts.entries()).sort((a, b) => b[1] - a[1]);
  console.log('Unmatched place names (name_zh):');
  for (const [name, cnt] of unmatched) console.log(`${String(cnt).padStart(3)}  ${name}`);
}

await audit();


