#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const args = { n: 20, events: 'data/events-1127-1142.jsonl', scenarios: 'public/scenarios' };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--n=')) args.n = Number(arg.slice(4)) || 20;
    else if (arg.startsWith('--events=')) args.events = arg.slice(9);
    else if (arg.startsWith('--scenarios=')) args.scenarios = arg.slice(12);
    else if (/^\d+$/.test(arg)) args.n = Number(arg);
    else if (arg.endsWith('.jsonl')) args.events = arg;
    else if (fs.existsSync(arg) && fs.lstatSync(arg).isDirectory()) args.scenarios = arg;
  }
  return args;
}

function readJSONL(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const items = [];
  for (const line of lines) {
    try {
      items.push(JSON.parse(line));
    } catch (e) {
      // skip malformed line
    }
  }
  return items;
}

function parseIsoStart(iso) {
  if (!iso) return { year: 0, month: 0, day: 0 };
  const parts = iso.split('-').map((p) => p.trim()).filter(Boolean);
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

function collectScenarioJsonFiles(scenariosPath) {
  const files = [];
  const stat = fs.lstatSync(scenariosPath);
  if (stat.isFile()) return [scenariosPath];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && p.endsWith('.json')) files.push(p);
    }
  };
  walk(scenariosPath);
  return files;
}

function collectReferencedEventIds(scenarioFiles) {
  const ids = new Set();
  for (const file of scenarioFiles) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      const cards = json?.cards;
      if (!cards || typeof cards !== 'object') continue;
      for (const key of Object.keys(cards)) {
        const card = cards[key];
        const refs = card?.['events-referenced'];
        if (Array.isArray(refs)) {
          for (const id of refs) {
            if (typeof id === 'string' && id.trim()) ids.add(id.trim());
          }
        }
      }
    } catch (e) {
      // ignore malformed scenario file
    }
  }
  return ids;
}

function formatDateRange(date) {
  if (!date) return '';
  const { iso_start, iso_end } = date;
  if (iso_start && iso_end && iso_start !== iso_end) return `${iso_start}—${iso_end}`;
  return iso_start || '';
}

function main() {
  const { n, events, scenarios } = parseArgs(process.argv);
  if (!fs.existsSync(events)) {
    console.error(`ERROR: events file not found: ${events}`);
    process.exit(1);
  }
  if (!fs.existsSync(scenarios)) {
    console.error(`ERROR: scenarios path not found: ${scenarios}`);
    process.exit(1);
  }
  const allEvents = readJSONL(events);
  const scenarioFiles = collectScenarioJsonFiles(scenarios);
  const referenced = collectReferencedEventIds(scenarioFiles);
  const unreferenced = allEvents.filter((ev) => !referenced.has(ev.id));
  const sorted = sortEventsChronologically(unreferenced);
  const take = sorted.slice(0, n);
  for (const ev of take) {
    const dateStr = formatDateRange(ev.date);
    const line = [
      dateStr.padEnd(17),
      ev.id.padEnd(40),
      ev.summary_en ? `— ${ev.summary_en}` : ''
    ].join(' ').trim();
    console.log(line);
  }
  if (sorted.length > n) {
    console.log(`\n… ${sorted.length - n} more unreferenced events`);
  }
}

main();


