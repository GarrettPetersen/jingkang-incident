#!/usr/bin/env node
// Export a precomputed board layout for the main game UI.
// Reads data/cities.json and data/connections.json, computes a Kamada-Kawai layout,
// orients it, normalizes to a fixed viewport, and writes src/map/board.ts with a MapGraph.

import fs from 'node:fs';
import path from 'node:path';

const CITIES = path.resolve(process.cwd(), 'data/cities.json');
const CONNS = path.resolve(process.cwd(), 'data/connections.json');
const OUT = path.resolve(process.cwd(), 'src/map/board.ts');

function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

function buildGraph() {
    const cities = JSON.parse(fs.readFileSync(CITIES, 'utf8'));
    const edgesData = JSON.parse(fs.readFileSync(CONNS, 'utf8')).edges || [];

    const nodes = cities.map(c => ({ id: c.id, label: (c.name_pinyin && c.name_pinyin.trim()) ? c.name_pinyin.trim() : (c.zh || c.id) }));
    const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));

    // Collapse multiple directed edges per unordered pair into a single kinds[] set
    const edgeKinds = new Map(); // pairKey -> Set kinds
    for (const e of edgesData) {
        const a = e.from, b = e.to;
        if (!idToIdx.has(a) || !idToIdx.has(b)) continue;
        const k = pairKey(a, b);
        if (!edgeKinds.has(k)) edgeKinds.set(k, new Set());
        const kinds = edgeKinds.get(k);
        if (e.surface === 'road') kinds.add('road');
        else if (e.surface === 'path') kinds.add('path');
        if (e.water) kinds.add('river'); // render as water if any water type exists
    }
    const edges = [];
    let eid = 0;
    for (const [k, kinds] of edgeKinds.entries()) {
        const [a, b] = k.split('|');
        edges.push({ id: 'e' + (++eid), a, b, kinds: Array.from(kinds) });
    }

    return { nodes, edges, idToIdx };
}

function floydWarshall(n, adj) {
    const INF = 1e9;
    const dist = Array.from({ length: n }, () => Array(n).fill(INF));
    for (let i = 0; i < n; i++) dist[i][i] = 0;
    for (let i = 0; i < n; i++) for (const j of adj[i]) dist[i][j] = 1;
    for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++) {
            const dik = dist[i][k]; if (dik === INF) continue;
            const dk = dist[k]; const di = dist[i];
            for (let j = 0; j < n; j++) {
                const via = dik + dk[j];
                if (via < di[j]) di[j] = via;
            }
        }
    }
    return dist;
}

function layout(graph) {
    const n = graph.nodes.length;
    const adj = Array.from({ length: n }, () => []);
    for (const e of graph.edges) {
        const i = graph.idToIdx.get(e.a), j = graph.idToIdx.get(e.b);
        if (i == null || j == null) continue;
        if (!adj[i].includes(j)) adj[i].push(j);
        if (!adj[j].includes(i)) adj[j].push(i);
    }
    const D = floydWarshall(n, adj);
    const INF = 1e9;
    const L0 = 42;
    const K0 = 1.2;
    const L = Array.from({ length: n }, () => Array(n).fill(0));
    const K = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const dij = D[i][j];
            if (dij < INF / 2 && dij > 0) {
                L[i][j] = L0 * dij;
                K[i][j] = K0 / (dij * dij);
            }
        }
    }

    let X = new Float64Array(n), Y = new Float64Array(n);
    function initPositions() {
        const R = 250;
        for (let i = 0; i < n; i++) {
            const t = 2 * Math.PI * i / n + (Math.random() - 0.5) * 0.2;
            X[i] = R * Math.cos(t);
            Y[i] = R * Math.sin(t);
        }
    }
    function kkLayout(maxOuter = 4200, eps = 1e-4) {
        function dE(i) {
            let dEx = 0, dEy = 0, d2Exx = 0, d2Eyy = 0, d2Exy = 0;
            const xi = X[i], yi = Y[i];
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const k = K[i][j]; if (k === 0) continue;
                const l = L[i][j];
                const dx = xi - X[j];
                const dy = yi - Y[j];
                let dist = Math.hypot(dx, dy);
                if (dist < 1e-6) dist = 1e-6;
                const common = k * (1 - l / dist);
                dEx += common * dx;
                dEy += common * dy;
                const dist3 = dist * dist * dist;
                d2Exx += k * (1 - l * (dy * dy) / dist3);
                d2Eyy += k * (1 - l * (dx * dx) / dist3);
                d2Exy += k * (l * dx * dy / dist3);
            }
            return { dEx, dEy, d2Exx, d2Eyy, d2Exy };
        }
        for (let it = 0; it < maxOuter; it++) {
            let maxG = 0, maxI = 0;
            for (let i = 0; i < n; i++) {
                const { dEx, dEy } = dE(i);
                const g = Math.hypot(dEx, dEy);
                if (g > maxG) { maxG = g; maxI = i; }
            }
            if (maxG < eps) break;
            for (let inner = 0; inner < 300; inner++) {
                const { dEx, dEy, d2Exx, d2Eyy, d2Exy } = dE(maxI);
                const a = d2Exx, b = d2Exy, c = d2Exy, d = d2Eyy;
                const det = a * d - b * c || 1e-9;
                const dx = (-d * dEx + b * dEy) / det;
                const dy = (c * dEx - a * dEy) / det;
                X[maxI] += dx; Y[maxI] += dy;
                if (Math.hypot(dx, dy) < eps) break;
            }
        }
        return { X, Y };
    }

    let best = { X: null, Y: null, score: Infinity };
    for (let t = 0; t < 60; t++) {
        initPositions();
        const r = kkLayout(3600, 2.5e-4);
        // simplistic crossing count
        function countCrossings() {
            const pairs = [];
            const present = new Set();
            for (const e of graph.edges) {
                const i = graph.idToIdx.get(e.a), j = graph.idToIdx.get(e.b);
                if (i == null || j == null) continue;
                const k = pairKey(String(i), String(j));
                if (present.has(k)) continue; present.add(k);
                pairs.push([i, j]);
            }
            function segsIntersect(a1, a2, b1, b2) {
                if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) return false;
                const x1 = r.X[a1], y1 = r.Y[a1], x2 = r.X[a2], y2 = r.Y[a2];
                const x3 = r.X[b1], y3 = r.Y[b1], x4 = r.X[b2], y4 = r.Y[b2];
                function orient(ax, ay, bx, by, cx, cy) { return Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)); }
                const o1 = orient(x1, y1, x2, y2, x3, y3);
                const o2 = orient(x1, y1, x2, y2, x4, y4);
                const o3 = orient(x3, y3, x4, y4, x1, y1);
                const o4 = orient(x3, y3, x4, y4, x2, y2);
                if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
                return (o1 !== o2) && (o3 !== o4);
            }
            let c = 0;
            for (let i = 0; i < pairs.length; i++)
                for (let j = i + 1; j < pairs.length; j++)
                    if (segsIntersect(pairs[i][0], pairs[i][1], pairs[j][0], pairs[j][1])) c++;
            return c;
        }
        const c = countCrossings();
        if (c < best.score) best = { X: Float64Array.from(r.X), Y: Float64Array.from(r.Y), score: c };
        if (best.score === 0) break;
    }
    // adopt best positions
    X = best.X; Y = best.Y;

    // Orientation: encourage south below north, east to the right of west
    const northIds = ['yanan', 'kaifeng', 'huaiyang', 'huaiyin'];
    const southIds = ['hangzhou', 'ningbo', 'nanchang', 'jianzhou-fj'];
    const eastIds = ['ningbo', 'suzhou-js'];
    const westIds = ['yanan', 'chengdu'];
    function indicesOf(arr) { return arr.map(id => graph.idToIdx.get(id)).filter(i => i != null); }
    const north = indicesOf(northIds), south = indicesOf(southIds), east = indicesOf(eastIds), west = indicesOf(westIds);
    function scoreOrientation(tx, ty) {
        const avg = (idxs, arr) => idxs.length ? idxs.reduce((s, i) => s + arr[i], 0) / idxs.length : 0;
        const southY = avg(south, ty), northY = avg(north, ty);
        const eastX = avg(east, tx), westX = avg(west, tx);
        return (southY - northY) + (eastX - westX);
    }
    function applyTransform(theta, mirrorX) {
        const ct = Math.cos(theta), st = Math.sin(theta);
        const tx = new Float64Array(n), ty = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            let nx = ct * X[i] - st * Y[i];
            let ny = st * X[i] + ct * Y[i];
            if (mirrorX) nx = -nx; tx[i] = nx; ty[i] = ny;
        }
        return { tx, ty };
    }
    let bestScore = -Infinity, bestTX = X, bestTY = Y;
    for (let k = 0; k < 360; k++) {
        const th = 2 * Math.PI * k / 360;
        for (const mirror of [false, true]) {
            const { tx, ty } = applyTransform(th, mirror);
            const s = scoreOrientation(tx, ty);
            if (s > bestScore) { bestScore = s; bestTX = tx; bestTY = ty; }
        }
    }
    X = bestTX; Y = bestTY;

    // Normalize to fixed viewport
    const WIDTH = 1200, HEIGHT = 800, MARGIN = 40;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]); }
    const sx = (WIDTH - 2 * MARGIN) / (maxX - minX || 1);
    const sy = (HEIGHT - 2 * MARGIN) / (maxY - minY || 1);
    const s = Math.min(sx, sy);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const pos = new Map();
    for (let i = 0; i < n; i++) {
        const x = WIDTH / 2 + (X[i] - cx) * s;
        const y = HEIGHT / 2 + (Y[i] - cy) * s;
        pos.set(graph.nodes[i].id, { x: Math.round(x), y: Math.round(y) });
    }

    return { pos, WIDTH, HEIGHT };
}

function writeBoard(graph, layout) {
    const nodesObj = {};
    for (const n of graph.nodes) {
        const p = layout.pos.get(n.id);
        nodesObj[n.id] = { id: n.id, x: p.x, y: p.y, label: n.label, kind: 'city' };
    }
    const edgesObj = {};
    graph.edges.forEach((e, idx) => {
        edgesObj[e.id] = { id: e.id, a: e.a, b: e.b, kinds: e.kinds };
    });

    const out = `// AUTO-GENERATED by scripts/exportBoardLayout.mjs
import type { MapGraph } from '../core/types';

export const map: MapGraph = ${JSON.stringify({ nodes: nodesObj, edges: edgesObj }, null, 2)} as const;
`;
    const outDir = path.dirname(OUT);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUT, out, 'utf8');
    console.log(`Wrote ${OUT}`);
}

function main() {
    const graph = buildGraph();
    const layout = layoutGraph(graph);
}

function layoutGraph(graph) {
    return layout(graph);
}

const graph = buildGraph();
const lay = layoutGraph(graph);
writeBoard(graph, lay);
