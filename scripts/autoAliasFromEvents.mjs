#!/usr/bin/env node
// Auto-map event place labels to hubs by keyword rules; add missing hubs where obvious.

import fs from 'node:fs';
import path from 'node:path';

const CITIES = path.resolve(process.cwd(), 'data/cities.json');
const EVENTS = path.resolve(process.cwd(), 'data/events-1127-1142.jsonl');

function loadCities() {
    const cities = JSON.parse(fs.readFileSync(CITIES, 'utf8'));
    const byId = new Map(cities.map(c => [c.id, c]));
    return { cities, byId };
}

function ensureCity(byId, cities, id, zh, pinyin, aliases = []) {
    if (byId.has(id)) return byId.get(id);
    const obj = { id, zh, pinyin, aliases: aliases.slice(), name_zh: zh, name_pinyin: pinyin, type: 'city' };
    cities.push(obj); byId.set(id, obj);
    console.log(`Added hub: ${id} (${zh})`);
    return obj;
}

function addAlias(byId, id, alias) {
    const c = byId.get(id); if (!c) return;
    if (!Array.isArray(c.aliases)) c.aliases = [];
    if (!c.aliases.includes(alias)) c.aliases.push(alias);
}

function main() {
    const { cities, byId } = loadCities();

    // Ensure a few missing obvious hubs used by rules
    ensureCity(byId, cities, 'xiangyang', '襄陽', 'Xiangyang');
    ensureCity(byId, cities, 'shaoxing', '紹興', 'Shaoxing', ['越州']);
    ensureCity(byId, cities, 'guangzhou', '廣州', 'Guangzhou');

    // Rules: regex -> list of target city ids
    const rules = [
        [/荊湖|洞庭|岳陽|岳州/u, ['yueyang', 'tanzhou']],
        [/淮西|淮南|淮東|淮甸|淮/u, ['yangzhou', 'huaiyin']],
        [/江南|江東/u, ['hangzhou', 'nanjing']],
        [/江西/u, ['nanchang', 'jiujiang']],
        [/襄陽|襄漢|隨|郢/u, ['xiangyang', 'jiujiang']],
        [/紹興|越州|會稽/u, ['shaoxing', 'hangzhou']],
        [/廣州/u, ['guangzhou']],
        [/白河/u, ['yanjing']],
        [/汝州/u, ['huaiyang', 'kaifeng']],
        [/黃天蕩|金山/u, ['zhenjiang']],
        [/定海|昌國/u, ['ningbo']],
        [/太平州/u, ['nanjing']],
        [/泗州|沐陽/u, ['huaiyin']],
        [/六合|靜安鎮/u, ['nanjing']],
        [/武陵/u, ['tanzhou']],
        [/鼎州/u, ['tanzhou']],
        [/邕州|南寧/u, ['yongzhou-gn']],
        [/兩浙/u, ['hangzhou', 'ningbo', 'fuzhou', 'quanzhou']],
        [/福建/u, ['fuzhou', 'quanzhou']],
        [/河南/u, ['kaifeng']],
        [/河北/u, ['yanjing']],
        [/山東/u, ['cangzhou', 'haizhou']],
    ];

    const lines = fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean);
    let added = 0;
    for (const line of lines) {
        let evt; try { evt = JSON.parse(line); } catch { continue; }
        const places = evt.places || {};
        const consider = [];
        if (places.primary && typeof places.primary === 'object') consider.push(places.primary);
        if (Array.isArray(places.other)) consider.push(...places.other);
        for (const p of consider) {
            const nm = (p && (p.name_zh || p.name)) ? (p.name_zh || p.name).toString().trim() : '';
            if (!nm) continue;
            // See which rules match; add alias to all targets
            for (const [re, targets] of rules) {
                if (re.test(nm)) {
                    for (const id of targets) { addAlias(byId, id, nm); added++; }
                }
            }
        }
    }

    fs.writeFileSync(CITIES, JSON.stringify(cities, null, 2), 'utf8');
    console.log(`Auto-mapped aliases from events: ${added} entries (including duplicates).`);
}

main();


