import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import path from 'node:path';

// Canonical place set (15) and alias map
const PLACES = [
  { id: 'hangzhou', zh: '臨安', pinyin: 'Lin’an (Hangzhou)', aliases: ['杭州', '錢塘', '臨平', '湧金門'] },
  { id: 'kaifeng', zh: '汴京', pinyin: 'Bianjing (Kaifeng)', aliases: ['東京', '汴', '開封'] },
  { id: 'nanjing', zh: '建康', pinyin: 'Jiankang (Nanjing)', aliases: ['江寧', '南京'] },
  { id: 'suzhou-js', zh: '蘇州', pinyin: 'Suzhou (Pingjiang Fu)', aliases: ['平江', '平江府', '蘇州府'] },
  { id: 'zhenjiang', zh: '鎮江', pinyin: 'Zhenjiang', aliases: ['京口', '金山', '黃天蕩', '江陰', '鎮江府'] },
  { id: 'yangzhou', zh: '揚州', pinyin: 'Yangzhou', aliases: ['大儀', '高郵', '廣陵'] },
  { id: 'huaiyin', zh: '楚州', pinyin: 'Chuzhou (Huai’an)', aliases: ['淮安', '承州', '漣水'] },
  { id: 'huaiyang', zh: '淮陽', pinyin: 'Huaiyang', aliases: ['泇口鎮'] },
  { id: 'suzhou-anhui', zh: '宿州', pinyin: 'Suzhou (Anhui)', aliases: ['亳州'] },
  { id: 'hefei', zh: '廬州', pinyin: 'Luzhou (Hefei)', aliases: ['合肥', '和州', '巢縣', '昭關', '柘皋', '含山'] },
  { id: 'ningbo', zh: '明州', pinyin: 'Mingzhou (Ningbo)', aliases: ['余姚', '寧波'] },
  { id: 'nanchang', zh: '南昌', pinyin: 'Nanchang', aliases: ['豫章', '筠州', '臨江'] },
  { id: 'jiujiang', zh: '江州', pinyin: 'Jiujiang', aliases: ['九江', '黃梅'] },
  { id: 'jianzhou-fj', zh: '建州', pinyin: 'Jianzhou (Fujian)', aliases: ['南劍州', '劍潭'] },
  { id: 'yanan', zh: '延安', pinyin: 'Yan’an', aliases: ['渭州'] },
];

const aliasToId = new Map();
for (const p of PLACES) {
  aliasToId.set(p.zh, p.id);
  for (const a of p.aliases) aliasToId.set(a, p.id);
}

function normalizeName(nameZh) {
  if (!nameZh) return undefined;
  // Trim common suffixes like "府", "軍" when they precede known aliases
  const stripped = nameZh.replace(/[\s\u00A0]+/g, '').replace(/(府|軍)$/u, '');
  return aliasToId.get(stripped) || aliasToId.get(nameZh) || undefined;
}

async function emitNormalizedPlaceIds(eventsPath) {
  const stream = createReadStream(eventsPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      const ids = new Set();
      const p = obj.places || {};
      const primary = p.primary && p.primary.name_zh;
      const other = Array.isArray(p.other) ? p.other.map(x => x && x.name_zh) : [];
      const allNames = [primary, ...other].filter(Boolean);
      for (const n of allNames) {
        const id = normalizeName(n);
        if (id) ids.add(id);
      }
      const out = { id: obj.id, place_ids: Array.from(ids) };
      console.log(JSON.stringify(out));
    } catch {
      // ignore malformed lines
    }
  }
}

async function writeCitiesJson(citiesPath) {
  const payload = PLACES.map(p => ({ id: p.id, zh: p.zh, pinyin: p.pinyin, aliases: p.aliases }));
  await writeFile(citiesPath, JSON.stringify(payload, null, 2), 'utf8');
}

// Hand-trimmed 15-node network (undirected edges as pairs)
const CONNECTIONS = [
  ['hangzhou', 'suzhou-js'],
  ['hangzhou', 'zhenjiang'],
  ['hangzhou', 'ningbo'],
  ['hangzhou', 'jianzhou-fj'],
  ['zhenjiang', 'suzhou-js'],
  ['zhenjiang', 'yangzhou'],
  ['zhenjiang', 'nanjing'],
  ['nanjing', 'hefei'],
  ['yangzhou', 'huaiyin'],
  ['huaiyin', 'huaiyang'],
  ['huaiyin', 'suzhou-anhui'],
  ['huaiyang', 'suzhou-anhui'],
  ['suzhou-anhui', 'hefei'],
  ['ningbo', 'jianzhou-fj'],
  ['nanchang', 'jiujiang'],
  ['jiujiang', 'zhenjiang'],
  ['nanchang', 'hangzhou'],
  ['kaifeng', 'huaiyang'],
  ['kaifeng', 'yanan'],
];

async function writeConnectionsJson(connectionsPath) {
  const nodes = new Set(PLACES.map(p => p.id));
  const edges = CONNECTIONS.filter(([a, b]) => nodes.has(a) && nodes.has(b))
    .map(([a, b]) => ({ a, b }));
  await writeFile(connectionsPath, JSON.stringify({ nodes: Array.from(nodes), edges }, null, 2), 'utf8');
}

async function main() {
  const eventsPath = process.argv[2] || path.resolve('data/events-1127-1142.jsonl');
  const citiesPath = process.argv[3] || path.resolve('data/cities.json');
  const connectionsPath = process.argv[4] || path.resolve('data/connections.json');

  // Emit normalized IDs to stdout
  await emitNormalizedPlaceIds(eventsPath);
  // Write trimmed city list and connections
  await writeCitiesJson(citiesPath);
  await writeConnectionsJson(connectionsPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


