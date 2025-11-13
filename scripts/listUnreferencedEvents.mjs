#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const EVENTS_FILE = path.join(repoRoot, 'data', 'events-1127-1142.jsonl');
const EXCLUDE_FILE = path.join(repoRoot, 'data', 'events-exclude.json');
const SCENARIOS_DIR = path.join(repoRoot, 'public', 'scenarios');

async function readJsonlIds(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const ids = new Set();
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.id === 'string') ids.add(obj.id);
    } catch {
      // ignore bad lines
    }
  }
  return ids;
}

async function readExcludeList(filePath) {
  try {
    const buf = await fs.readFile(filePath, 'utf8');
    const arr = JSON.parse(buf);
    if (Array.isArray(arr)) return new Set(arr.map(String));
  } catch {
    // fall through
  }
  return new Set();
}

async function readScenarioReferencedEvents(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const refs = new Set();
  for (const ent of entries) {
    const p = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      const subRefs = await readScenarioReferencedEvents(p);
      subRefs.forEach((id) => refs.add(id));
    } else if (ent.isFile() && ent.name.endsWith('.json')) {
      try {
        const buf = await fs.readFile(p, 'utf8');
        const json = JSON.parse(buf);
        if (json && json.cards && typeof json.cards === 'object') {
          for (const card of Object.values(json.cards)) {
            const arr = Array.isArray(card?.['events-referenced']) ? card['events-referenced'] : [];
            for (const id of arr) refs.add(String(id));
          }
        }
      } catch {
        // ignore invalid json
      }
    }
  }
  return refs;
}

function diff(setA, setB) {
  const out = new Set();
  for (const v of setA) if (!setB.has(v)) out.add(v);
  return out;
}

async function readJsonlItems(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const items = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.id === 'string') items.push(obj);
    } catch {
      // ignore bad lines
    }
  }
  return items;
}

function parseIsoStart(iso) {
  if (!iso) return { year: 0, month: 0, day: 0 };
  const parts = String(iso).split('-');
  const year = Number(parts[0]) || 0;
  const month = parts.length >= 2 ? Number(parts[1]) || 0 : 0;
  const day = parts.length >= 3 ? Number(parts[2]) || 0 : 0;
  return { year, month, day };
}

function sortEventsChronologically(events) {
  return [...events].sort((a, b) => {
    const A = parseIsoStart(a?.date?.iso_start);
    const B = parseIsoStart(b?.date?.iso_start);
    if (A.year !== B.year) return A.year - B.year;
    if (A.month !== B.month) return A.month - B.month;
    return A.day - B.day;
  });
}

function parseCli(argv) {
  const out = { n: undefined, events: undefined, scenarios: undefined, exclude: undefined };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--n=')) out.n = Number(arg.slice(4)) || undefined;
    else if (arg.startsWith('--events=')) out.events = arg.slice(9);
    else if (arg.startsWith('--scenarios=')) out.scenarios = arg.slice(12);
    else if (arg.startsWith('--exclude=')) out.exclude = arg.slice(10);
    else if (/^\d+$/.test(arg)) out.n = Number(arg);
  }
  return out;
}

async function main() {
  const cli = parseCli(process.argv);
  const eventsPath = path.resolve(repoRoot, cli.events || EVENTS_FILE);
  const scenariosPath = path.resolve(repoRoot, cli.scenarios || SCENARIOS_DIR);
  const excludePath = path.resolve(repoRoot, cli.exclude || EXCLUDE_FILE);
  const limit = typeof cli.n === 'number' ? cli.n : (process.env.N ? Number(process.env.N) : undefined);

  const allEventIds = await readJsonlIds(eventsPath);
  const allEvents = await readJsonlItems(eventsPath);
  const exclude = await readExcludeList(excludePath);
  const referenced = await readScenarioReferencedEvents(scenariosPath);

  const considered = diff(allEventIds, exclude);
  const unreferencedIdSet = diff(considered, referenced);
  const unreferencedEvents = allEvents.filter(ev => unreferencedIdSet.has(ev.id));
  const unreferencedSorted = sortEventsChronologically(unreferencedEvents);

  // Summary
  console.log(`Total events: ${allEventIds.size}`);
  console.log(`Excluded: ${exclude.size}`);
  console.log(`Referenced: ${referenced.size}`);
  console.log(`Unreferenced (excluding excluded): ${unreferencedIdSet.size}`);
  console.log('');
  const list = unreferencedSorted.map(ev => ev.id);
  const cut = typeof limit === 'number' && limit >= 0 ? list.slice(0, limit) : list;
  cut.forEach((id) => console.log(id));
  if (cut.length < list.length) {
    console.log(`\n… ${list.length - cut.length} more unreferenced events`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

