#!/usr/bin/env node
// Analyze data/cities.json and flag likely duplicates/containment (e.g., prefecture vs city of same base).
// Outputs data/city_duplicates.json with clusters and suggested canonical choices.

import fs from 'node:fs';
import path from 'node:path';

const CITIES_PATH = path.resolve(process.cwd(), 'data/cities.json');
const OUT_PATH = path.resolve(process.cwd(), 'data/city_duplicates.json');

// Administrative settlement types (for duplicate consideration)
const adminTypes = new Set([
    'capital', 'metropolis', 'city', 'prefecture-capital', 'prefecture', 'county', 'town', 'port', 'market'
]);
// Non-admin nodes kept distinct
const nonAdminTypes = new Set(['gate', 'fort', 'fortress', 'garrison']);

// Suffix tokens to strip from the END of names for base-keying
const stripSuffixes = [
    '府城', '州城', '縣城', '县城',
    '府', '州', '軍', '军', '郡', '縣', '县', '鎮', '镇', '城'
];

// Known synonym groups → canonical form
const synonymGroups = [
    ['開封', '开封', '汴京', '汴梁', '東京', '东京', '汴州'],
    ['杭州', '臨安', '临安'],
    ['建康', '江寧', '江宁', '南京'],
];
const synonymMap = (() => {
    const m = new Map();
    for (const group of synonymGroups) {
        const canonical = group[0];
        for (const n of group) m.set(n, canonical);
    }
    return m;
})();

function normalizeZhName(name) {
    return (name || '').toString().trim();
}

function toBaseKey(zh) {
    let s = normalizeZhName(zh);
    if (!s) return '';
    // strip parenthetical (Chinese or ASCII)
    s = s.replace(/[（(].*?[）)]/g, '').trim();
    if (synonymMap.has(s)) return synonymMap.get(s);
    // strip one or more suffixes if present at end
    let changed = true;
    while (changed) {
        changed = false;
        for (const suf of stripSuffixes) {
            if (s.length > suf.length && s.endsWith(suf)) {
                s = s.slice(0, -suf.length);
                changed = true;
            }
        }
    }
    return s || zh; // fallback to original if emptied
}

function scoreType(t) {
    // Higher score preferred as canonical
    switch (t) {
        case 'capital': return 100;
        case 'metropolis': return 95;
        case 'prefecture-capital': return 90;
        case 'city': return 80;
        case 'prefecture': return 70;
        case 'port': return 65;
        case 'county': return 60;
        case 'town': return 50;
        case 'market': return 40;
        default: return 10;
    }
}

function main() {
    if (!fs.existsSync(CITIES_PATH)) {
        console.error(`Not found: ${CITIES_PATH}`);
        process.exit(1);
    }
    const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));

    const clusters = new Map();
    for (const c of cities) {
        const zh = normalizeZhName(c.name_zh);
        const t = (c.type || '').toString().toLowerCase();
        const base = toBaseKey(zh);
        const entry = {
            name_zh: zh,
            name_pinyin: c.name_pinyin || '',
            type: t,
            referenced_by: Array.isArray(c.referenced_by) ? c.referenced_by : [],
        };
        if (!clusters.has(base)) clusters.set(base, []);
        clusters.get(base).push(entry);
    }

    const report = [];
    let dupClusterCount = 0;
    for (const [base, members] of clusters.entries()) {
        // separate admin vs non-admin
        const adminMembers = members.filter(m => adminTypes.has(m.type));
        if (adminMembers.length <= 1) continue; // only one admin-like => not a duplicate/containment case

        // Suggest canonical: most references; tie -> best type score
        const sorted = [...adminMembers].sort((a, b) => {
            const ra = a.referenced_by.length;
            const rb = b.referenced_by.length;
            if (ra !== rb) return rb - ra;
            return scoreType(b.type) - scoreType(a.type);
        });
        const canonical = sorted[0];
        const others = sorted.slice(1);

        // Heuristic: flag as duplicates if names differ only by suffixes or by known synonyms
        const distinctAdminNames = new Set(adminMembers.map(m => m.name_zh));
        if (distinctAdminNames.size > 1) {
            dupClusterCount++;
            report.push({
                base_name: base,
                members: adminMembers,
                suggested_canonical: canonical,
                suggested_merge: others,
            });
        }
    }

    // Write report
    const outDir = path.dirname(OUT_PATH);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify({
        duplicate_clusters: report,
        total_clusters: clusters.size,
        duplicate_cluster_count: dupClusterCount,
    }, null, 2), 'utf8');

    console.log(`Analyzed ${cities.length} cities; duplicate-like clusters: ${dupClusterCount}.`);
    console.log(`Wrote ${OUT_PATH}`);
}

main();
