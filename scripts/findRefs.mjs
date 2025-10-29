#!/usr/bin/env node
// Scan Songshi/Jinshi on chinesenotes.com for references to target places
// Usage: node scripts/findRefs.mjs <songshi|jinshi> [term1 term2 ...]

import { load } from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';

function zpad(n, w = 3) { return String(n).padStart(w, '0'); }

function normalizeWhitespace(text) {
    return text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isMostlyChinese(text) {
    const t = text.replace(/[\s\u200B\uFEFF]+/g, '');
    if (!t) return false;
    const chineseMatches = t.match(/[\p{Script=Han}]/gu);
    const latinMatches = t.match(/[A-Za-z]/g);
    const chineseCount = chineseMatches ? chineseMatches.length : 0;
    const latinCount = latinMatches ? latinMatches.length : 0;
    return chineseCount > 0 && chineseCount >= latinCount;
}

function extractParagraphs($) {
    const paragraphs = [];
    function shouldStop($el) {
        const t = normalizeWhitespace($el.text()).toLowerCase();
        if (!t) return false;
        return (
            t.startsWith('chinese text:') ||
            t.includes('glossary and other vocabulary') ||
            t.startsWith('dictionary cache status') ||
            t.startsWith('copyright') ||
            t.startsWith('abbreviations') ||
            t.startsWith('reference') ||
            t.startsWith('help') ||
            t.startsWith('about')
        );
    }
    function extractFromElement($el) {
        const $clone = $el.clone();
        $clone.find('br').replaceWith('\n');
        const raw = $clone.text().replace(/\r\n?/g, '\n');
        const lines = raw.split(/\n+/).map(normalizeWhitespace).filter(Boolean);
        for (const line of lines) {
            if (isMostlyChinese(line)) paragraphs.push(line);
        }
    }
    const $title = $('h3').first().length ? $('h3').first() : $('h2').first();
    if ($title.length) {
        let $cursor = $title.next();
        const safetyLimit = 2000; let steps = 0;
        while ($cursor && $cursor.length && steps < safetyLimit) {
            steps++;
            if (shouldStop($cursor)) break;
            const tag = ($cursor[0].tagName || '').toLowerCase();
            if (tag === 'h2' || tag === 'h3') break;
            if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
                extractFromElement($cursor);
            }
            $cursor = $cursor.next();
        }
    }
    if (paragraphs.length === 0) {
        $('p, div').each((_, el) => extractFromElement($(el)));
    }
    const deduped = [];
    for (const line of paragraphs) {
        if (deduped.length === 0 || deduped[deduped.length - 1] !== line) deduped.push(line);
    }
    return deduped;
}

function chapterUrl(book, idx) {
    return `https://chinesenotes.com/${book}/${book}${zpad(idx)}.html`;
}

async function fetchText(url) {
    const res = await fetch(url, { headers: { 'user-agent': 'jingkang-incident-scraper/1.0' } });
    if (!res.ok) return null;
    return await res.text();
}

function loadEventUrls() {
    const DATAFILE = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');
    const urls = new Set();
    try {
        if (fs.existsSync(DATAFILE)) {
            const lines = fs.readFileSync(DATAFILE, 'utf8').split(/\n+/).filter(Boolean);
            for (const line of lines) {
                try {
                    const evt = JSON.parse(line);
                    if (!evt) continue;
                    if (typeof evt.url === 'string') urls.add(evt.url);
                    if (Array.isArray(evt.sources)) {
                        for (const s of evt.sources) {
                            if (s && typeof s.url === 'string') urls.add(s.url);
                        }
                    }
                } catch { }
            }
        }
    } catch { }
    return urls;
}

async function main() {
    const book = (process.argv[2] || 'songshi').toLowerCase();
    if (!['songshi', 'jinshi'].includes(book)) {
        console.error('Usage: node scripts/findRefs.mjs <songshi|jinshi> [terms...]');
        process.exit(1);
    }
    const terms = process.argv.slice(3);
    const defaults = ['荊州', '江陵', '夷陵', '宜昌', '夔州', '荊門'];
    const needles = (terms.length ? terms : defaults).map(s => new RegExp(s, 'u'));

    const maxIdx = book === 'songshi' ? 500 : 130;
    const cited = loadEventUrls();
    const hits = [];

    for (let i = 1; i <= maxIdx; i++) {
        const url = chapterUrl(book, i);
        try {
            const html = await fetchText(url);
            if (!html) continue;
            const $ = load(html);
            const paragraphs = extractParagraphs($);
            let matchCount = 0;
            for (const p of paragraphs) {
                if (needles.some(re => re.test(p))) matchCount++;
            }
            if (matchCount > 0) {
                const title = normalizeWhitespace(($('h3').first().text() || $('h2').first().text() || '').trim());
                hits.push({ url, book, idx: i, title, matches: matchCount, cited: cited.has(url) });
            }
        } catch { }
    }

    // Sort: uncited first, then by index
    hits.sort((a, b) => (a.cited === b.cited ? a.idx - b.idx : (a.cited ? 1 : -1)));
    console.log(JSON.stringify({ book, terms: needles.map(r => r.source), hits }, null, 2));
}

await main();
