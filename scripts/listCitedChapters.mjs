#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DATA_FILE = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');

function collectUrlsFromEvent(evt) {
    const urls = [];
    if (evt && typeof evt.url === 'string') urls.push(evt.url);
    if (Array.isArray(evt.sources)) {
        for (const s of evt.sources) {
            if (s && typeof s.url === 'string') urls.push(s.url);
        }
    }
    return urls;
}

function normalizeChapterId(u) {
    try {
        const { pathname, hostname } = new URL(u);
        // Expect forms like /songshi/songshi029.html or /jinshi/jinshi077.html
        const parts = pathname.split('/').filter(Boolean);
        const file = parts[parts.length - 1] || '';
        // Return host + file for uniqueness across Songshi/Jinshi
        return `${hostname}/${file}`;
    } catch {
        return u;
    }
}

function groupByWork(url) {
    try {
        const { pathname } = new URL(url);
        if (pathname.includes('/songshi/')) return 'songshi';
        if (pathname.includes('/jinshi/')) return 'jinshi';
        return 'other';
    } catch {
        return 'other';
    }
}

function main() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`Data file not found: ${DATA_FILE}`);
        process.exit(1);
    }
    const text = fs.readFileSync(DATA_FILE, 'utf8');

    const seen = new Map(); // key: normalized id, value: {work, urls:Set}

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const evt = JSON.parse(trimmed);
            const urls = collectUrlsFromEvent(evt);
            for (const u of urls) {
                const key = normalizeChapterId(u);
                const work = groupByWork(u);
                if (!seen.has(key)) seen.set(key, { work, urls: new Set() });
                seen.get(key).urls.add(u);
            }
        } catch {
            // ignore malformed lines
        }
    }

    const entries = Array.from(seen.entries()).map(([key, info]) => ({ key, work: info.work, urls: Array.from(info.urls) }));
    entries.sort((a, b) => a.key.localeCompare(b.key));

    const byWork = entries.reduce((acc, e) => {
        if (!acc[e.work]) acc[e.work] = [];
        acc[e.work].push(e);
        return acc;
    }, {});

    for (const work of Object.keys(byWork).sort()) {
        const list = byWork[work];
        console.log(`\n=== ${work} (${list.length}) ===`);
        for (const e of list) {
            const sample = e.urls[0];
            console.log(`- ${e.key}  -> ${sample}`);
        }
    }
}

main();


