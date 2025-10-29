#!/usr/bin/env node
// Audit: find event place names not covered by cities.json (ids, zh, aliases, pinyin)

import fs from 'node:fs';
import path from 'node:path';

const CITIES = path.resolve(process.cwd(), 'data/cities.json');
const EVENTS = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');

function stripParen(s) {
  return (s || '').toString().replace(/[（(].*?[）)]/g, '').trim();
}
function baseZh(s) {
  let t = stripParen(s).replace(/[—–-]/g, ' ').replace(/一帶|一路|路|府|州|郡|縣|县|城$/g, '').trim();
  return t;
}
function norm(s) {
  return (s || '').toString().trim().toLowerCase();
}

function loadCities() {
  const arr = JSON.parse(fs.readFileSync(CITIES, 'utf8'));
  const known = new Set();
  const tokens = [];
  for (const c of arr) {
    const ids = [c.id, c.zh, c.pinyin, c.name_zh, c.name_pinyin];
    for (const v of ids) {
      if (!v) continue; known.add(norm(v)); tokens.push(v.toString());
      const b = baseZh(v); if (b && b !== v) { known.add(norm(b)); tokens.push(b); }
    }
    if (Array.isArray(c.aliases)) {
      for (const a of c.aliases) {
        known.add(norm(a)); tokens.push(a.toString());
        const b = baseZh(a); if (b && b !== a) { known.add(norm(b)); tokens.push(b); }
      }
    }
  }
  return { known, tokens };
}

function loadEventPlaces() {
  const out = [];
  const lines = fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    let evt; try { evt = JSON.parse(line); } catch { continue; }
    const id = evt.id;
    const places = evt.places || {};
    const consider = [];
    if (places.primary && typeof places.primary === 'object') consider.push(places.primary);
    if (Array.isArray(places.other)) consider.push(...places.other);
    for (const p of consider) {
      const name = p && (p.name_zh || p.name || '');
      if (!name) continue;
      out.push({ eventId: id, name_zh: name.toString(), type: p.type || '' });
    }
  }
  return out;
}

function suggest(name, tokens) {
  const n = baseZh(name);
  // crude suggestion: any token substring match
  const low = n.toLowerCase();
  const hits = [];
  for (const t of tokens) {
    const b = baseZh(t).toLowerCase();
    if (!b) continue;
    if (low.includes(b) || b.includes(low)) { hits.push(t); if (hits.length >= 5) break; }
  }
  return hits;
}

function main() {
  const { known, tokens } = loadCities();
  const places = loadEventPlaces();
  const missing = [];
  const seen = new Set();
  for (const pl of places) {
    const n = norm(pl.name_zh);
    const b = norm(baseZh(pl.name_zh));
    if (known.has(n) || known.has(b)) continue;
    const key = `${pl.name_zh}|${pl.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push(pl);
  }

  if (missing.length === 0) {
    console.log('All event places are covered by cities.json (id/zh/aliases).');
    return;
  }
  console.log(`Missing ${missing.length} unique place labels from cities.json:`);
  for (const m of missing.slice(0, 50)) {
    const hits = suggest(m.name_zh, tokens);
    const hint = hits.length ? ` | suggest: ${hits.join(', ')}` : '';
    console.log(`- ${m.name_zh} [${m.type}]${hint}`);
  }
  if (missing.length > 50) console.log(`... and ${missing.length - 50} more`);
}

main();


