#!/usr/bin/env node
// Print the only event for each city that appears exactly once in events.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const EVENTS_PATH = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');

function stripSuffix(name) {
  if (!name) return name;
  let t = name.replace(/[\s\u00A0]+/g, '');
  // remove ASCII or Chinese parentheses and content
  t = t.replace(/[（(][^）)]*[）)]/g, '');
  // trim common admin suffixes
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

async function gather() {
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  const { aliasToId, idToMeta } = buildAliasMap(cities);
  const counts = new Map(cities.map(c => [c.id, 0]));
  const onlyEvent = new Map(); // id -> event

  const rl = readline.createInterface({ input: fs.createReadStream(EVENTS_PATH, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
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
    for (const id of eventCityIds) {
      const c = (counts.get(id) || 0) + 1;
      counts.set(id, c);
      if (c === 1) {
        onlyEvent.set(id, obj);
      } else if (c === 2) {
        onlyEvent.delete(id); // no longer single
      }
    }
  }

  const singles = Array.from(onlyEvent.entries())
    .map(([id, ev]) => ({ id, zh: idToMeta.get(id)?.zh || '', pinyin: idToMeta.get(id)?.pinyin || '', event: ev }))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const s of singles) {
    const ev = s.event;
    const titleZh = (ev.chapter_title && ev.chapter_title.zh) || '';
    const titleEn = (ev.chapter_title && ev.chapter_title.en) || '';
    console.log(`\n=== ${s.id} ${s.zh} (${s.pinyin}) ===`);
    console.log(`id: ${ev.id}`);
    if (ev.url) console.log(`url: ${ev.url}`);
    if (titleZh || titleEn) console.log(`chapter: ${titleZh} ${titleEn ? ' / ' + titleEn : ''}`);
    if (ev.date) {
      const d = ev.date;
      console.log(`date: ${d.iso_start || ''}${d.iso_end && d.iso_end !== d.iso_start ? ' – ' + d.iso_end : ''}${d.era ? ' (' + d.era + ')' : ''}`);
    }
    if (ev.summary_en) console.log(`summary: ${ev.summary_en}`);
    if (ev.excerpt_zh) console.log(`excerpt_zh: ${ev.excerpt_zh}`);
  }
}

await gather();


