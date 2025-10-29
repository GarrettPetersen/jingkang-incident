#!/usr/bin/env node
// Replace cities with zero event mentions with cities that appear in events.
// 1) Count events per city using aliases
// 2) Remove zero-count cities
// 3) Add replacement cities from a curated list of unmatched city names found in events
// 4) Purge edges that reference removed cities (no edges added for new cities yet)

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const EVENTS_PATH = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');
const CONN_PATH = path.resolve(process.cwd(), 'data/connections.json');

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

async function countPerCity(cities) {
  const aliasToId = buildAliasMap(cities);
  const counts = new Map(cities.map(c => [c.id, 0]));
  const rl = readline.createInterface({ input: fs.createReadStream(EVENTS_PATH, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim(); if (!t) continue;
    let obj; try { obj = JSON.parse(t); } catch { continue; }
    const p = obj.places || {};
    const primary = p.primary && p.primary.name_zh ? [p.primary.name_zh] : [];
    const other = Array.isArray(p.other) ? p.other.map(x => x && x.name_zh).filter(Boolean) : [];
    const names = [...primary, ...other];
    const eventCityIds = new Set();
    for (const nm of names) {
      const a = nm.trim();
      const s = stripSuffix(a);
      const id = aliasToId.get(a) || aliasToId.get(s);
      if (id) eventCityIds.add(id);
    }
    for (const id of eventCityIds) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

// Curated replacements: cities observed in events (Chinese names) with chosen slugs & pinyins
const REPLACEMENTS = [
  { id: 'cangzhou', zh: '滄州', pinyin: 'Cangzhou' },
  { id: 'zhenzhou', zh: '真州', pinyin: 'Zhenzhou' },
  { id: 'taizhou', zh: '泰州', pinyin: 'Taizhou' },
  { id: 'haizhou', zh: '海州', pinyin: 'Haizhou' },
  { id: 'tongzhou', zh: '通州', pinyin: 'Tongzhou' },
  { id: 'xuanzhou', zh: '宣州', pinyin: 'Xuanzhou' },
  { id: 'wuzhou', zh: '婺州', pinyin: 'Wuzhou' },
  { id: 'fuzhou', zh: '福州', pinyin: 'Fuzhou' },
  { id: 'quanzhou', zh: '泉州', pinyin: 'Quanzhou' },
  { id: 'tanzhou', zh: '潭州', pinyin: 'Tanzhou' },
  { id: 'zhaozhou', zh: '趙州', pinyin: 'Zhaozhou' },
  { id: 'pingzhou', zh: '平州', pinyin: 'Pingzhou' }
];

async function main() {
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  const counts = await countPerCity(cities);
  const zeroIds = cities.filter(c => (counts.get(c.id) || 0) === 0).map(c => c.id);
  if (zeroIds.length === 0) {
    console.log('No zero-event cities to replace.');
    return;
  }
  console.log(`Zero-event cities: ${zeroIds.join(', ')}`);

  // Build new cities list: keep non-zero and add replacements up to same count
  const kept = cities.filter(c => (counts.get(c.id) || 0) > 0);
  const needed = zeroIds.length;
  const chosen = REPLACEMENTS.slice(0, needed).map(r => ({
    id: r.id,
    zh: r.zh,
    pinyin: r.pinyin,
    aliases: [],
    name_zh: r.zh,
    name_pinyin: r.pinyin,
    type: 'city'
  }));
  const nextCities = [...kept, ...chosen];
  fs.writeFileSync(CITIES_PATH, JSON.stringify(nextCities, null, 2), 'utf8');
  console.log(`Wrote ${CITIES_PATH} with ${nextCities.length} cities.`);

  // Remove edges involving removed ids
  const data = JSON.parse(fs.readFileSync(CONN_PATH, 'utf8'));
  const removed = new Set(zeroIds);
  const edges = (data.edges || []).filter(e => !removed.has(e.from) && !removed.has(e.to));
  fs.writeFileSync(CONN_PATH, JSON.stringify({ edges }, null, 2), 'utf8');
  console.log(`Removed edges referencing: ${zeroIds.join(', ')}. Wrote ${CONN_PATH}.`);
}

await main();


