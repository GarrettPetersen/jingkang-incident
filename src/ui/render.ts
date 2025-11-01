import type { GameState, NodeId, Piece } from '../core/types';
import { viewingPlayer, FactionColor } from '../core/types';

// Visual constants
const SHIP_H = 8; // ship visual height (about half of the 16px cube/horse slot)

// FLIP animation utilities for cards/pieces moving between zones
const cardKeyMap: WeakMap<any, string> = new WeakMap();
let cardKeyCounter = 0;
function getStableCardKey(card: any): string {
  let k = cardKeyMap.get(card);
  if (!k) {
    k = `c${++cardKeyCounter}`;
    cardKeyMap.set(card, k);
  }
  return k;
}

let prevRects: Map<string, DOMRect> = new Map();
function collectRects(root: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>('[data-key]')
    .forEach((el) => {
      const key = el.getAttribute('data-key');
      if (!key) return;
      map.set(key, el.getBoundingClientRect());
    });
  return map;
}

function runFLIP(root: HTMLElement): void {
  const current: Map<string, { el: HTMLElement; rect: DOMRect }> = new Map();
  root.querySelectorAll<HTMLElement>('[data-key]')
    .forEach((el) => {
      const key = el.getAttribute('data-key');
      if (!key) return;
      current.set(key, { el, rect: el.getBoundingClientRect() });
    });

  const drawPileKey = `pile:draw:global`;
  const drawPileRect = current.get(drawPileKey)?.rect;

  current.forEach(({ el, rect }, key) => {
    let from = prevRects.get(key);
    if (!from && key.startsWith('card:') && drawPileRect) {
      from = drawPileRect;
    }
    if (!from) return;
    const dx = from.left - rect.left;
    const dy = from.top - rect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.transition = 'transform 0s';
    requestAnimationFrame(() => {
      el.style.transition = 'transform 250ms ease-out';
      el.style.transform = 'translate(0px, 0px)';
      setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
      }, 300);
    });
  });

  prevRects = new Map();
  current.forEach(({ rect }, key) => prevRects.set(key, rect));
}

export function renderApp(root: HTMLElement, state: GameState, handlers: {
  onPlayCard: (cardId: string) => void;
  onSelectPiece: (pieceId: string) => void;
  onSelectNode: (nodeId: NodeId) => void;
  onEndTurn: () => void;
  onUndo: () => void;
}): void {
  // Capture pre-render rects for FLIP
  prevRects = collectRects(root);
  root.innerHTML = '';

  const container = document.createElement('div');
  container.style.display = 'grid';
  container.style.gridTemplateRows = '120px 1fr 180px';
  container.style.gridTemplateColumns = '240px 1fr 240px';
  container.style.gridTemplateAreas = `
    'opps opps opps'
    'left board right'
    'hand hand hand'
  `;
  container.style.height = '100vh';
  container.style.gap = '12px';

  const left = renderLeftPanel(state, handlers);
  left.style.gridArea = 'left';
  container.appendChild(left);

  const board = renderBoard(state, handlers);
  (board as any).style.gridArea = 'board';
  container.appendChild(board);

  const right = renderRightPanel(state);
  right.style.gridArea = 'right';
  container.appendChild(right);

  const hand = renderHand(state, handlers);
  hand.style.gridArea = 'hand';
  container.appendChild(hand);

  const opps = renderOpponents(state);
  opps.style.gridArea = 'opps';
  container.appendChild(opps);

  root.appendChild(container);
  // Animate transitions
  runFLIP(root);
}

function renderLeftPanel(state: GameState, handlers: any): HTMLElement {
  const div = document.createElement('div');
  const player = viewingPlayer(state);
  const h = document.createElement('h3');
  h.textContent = `Viewing: ${player.name}`;
  div.appendChild(h);

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.flexDirection = 'column';
  controls.style.gap = '8px';
  const endBtn = document.createElement('button');
  endBtn.textContent = 'End Turn';
  endBtn.onclick = () => handlers.onEndTurn();
  endBtn.disabled = !state.hasPlayedThisTurn;
  if (endBtn.disabled) endBtn.style.opacity = '0.5';
  const undoBtn = document.createElement('button');
  undoBtn.textContent = 'Undo Turn';
  undoBtn.onclick = () => handlers.onUndo();
  undoBtn.disabled = !state.hasActedThisTurn;
  if (undoBtn.disabled) undoBtn.style.opacity = '0.5';
  controls.appendChild(endBtn);
  controls.appendChild(undoBtn);
  div.appendChild(controls);

  if (state.prompt) {
    const p = document.createElement('div');
    p.style.marginTop = '8px';
    p.textContent = state.prompt.message;
    div.appendChild(p);
  }

  // Global Draw pile (left of board)
  const deckWrap = document.createElement('div');
  deckWrap.style.marginTop = '12px';
  const deckLbl = document.createElement('div');
  deckLbl.textContent = 'Draw Pile';
  deckLbl.style.fontSize = '12px';
  deckLbl.style.color = '#ccc';
  const draw = renderPile('Draw', '/cards/back.svg', state.drawPile.cards.length);
  draw.setAttribute('data-key', 'pile:draw:global');
  deckWrap.appendChild(deckLbl);
  deckWrap.appendChild(draw);
  div.appendChild(deckWrap);

  return div;
}

function renderRightPanel(state: GameState): HTMLElement {
  const div = document.createElement('div');
  // Global Discard pile (right of board)
  const discWrap = document.createElement('div');
  const discLbl = document.createElement('div');
  discLbl.textContent = 'Discard Pile';
  discLbl.style.fontSize = '12px';
  discLbl.style.color = '#ccc';
  const discard = renderPile('Discard', '/cards/back.svg', state.discardPile.cards.length);
  discard.setAttribute('data-key', 'pile:discard:global');
  discWrap.appendChild(discLbl);
  discWrap.appendChild(discard);
  div.appendChild(discWrap);

  const h2 = document.createElement('h3');
  h2.textContent = 'Log';
  div.appendChild(h2);
  const ul = document.createElement('ul');
  for (const entry of state.log.slice(-10)) {
    const li = document.createElement('li');
    li.textContent = entry.message;
    ul.appendChild(li);
  }
  div.appendChild(ul);
  return div;
}

function renderBoard(state: GameState, handlers: any): HTMLElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const VIEW_W = 1200;
  const VIEW_H = 800;
  const MAP_SCALE = 1.4; // static scale to spread the map; pieces/characters keep pixel size
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.style.border = 'none';
  svg.style.background = '#fff';
  svg.style.width = '100%';
  svg.style.height = '100%';

  // Pan/zoom container
  let scale = 1;
  let tx = 0, ty = 0;
  const scene = document.createElementNS('http://www.w3.org/2000/svg', 'g'); // world layer
  const mapLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const overlayLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g'); // pieces + characters
  const capitalsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g'); // capitals above characters
  mapLayer.setAttribute('transform', `scale(${MAP_SCALE})`);
  scene.appendChild(mapLayer);
  scene.appendChild(overlayLayer);
  scene.appendChild(capitalsLayer);
  function applyTransform() {
    scene.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
  }
  function clampPan() {
    const w = svg.clientWidth || 0;
    const h = svg.clientHeight || 0;
    const contentW = VIEW_W * MAP_SCALE * scale;
    const contentH = VIEW_H * MAP_SCALE * scale;
    if (contentW <= w) {
      tx = Math.round((w - contentW) / 2);
    } else {
      const minTx = w - contentW;
      const maxTx = 0;
      if (tx < minTx) tx = minTx;
      if (tx > maxTx) tx = maxTx;
    }
    if (contentH <= h) {
      ty = Math.round((h - contentH) / 2);
    } else {
      const minTy = h - contentH;
      const maxTy = 0;
      if (ty < minTy) ty = minTy;
      if (ty > maxTy) ty = maxTy;
    }
  }
  applyTransform();

  // Color tint filters for capital markers (use SourceAlpha to flood with a color)
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  function makeTintFilter(id: string, color: string, stroke: string) {
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', id);
    // Outline: dilate SourceAlpha then color it with stroke
    const morph = document.createElementNS('http://www.w3.org/2000/svg', 'feMorphology');
    morph.setAttribute('in', 'SourceAlpha');
    morph.setAttribute('operator', 'dilate');
    morph.setAttribute('radius', '1.5');
    morph.setAttribute('result', 'outline');
    const floodOutline = document.createElementNS('http://www.w3.org/2000/svg', 'feFlood');
    floodOutline.setAttribute('flood-color', stroke);
    floodOutline.setAttribute('result', 'strokeColor');
    const compOutline = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
    compOutline.setAttribute('in', 'strokeColor');
    compOutline.setAttribute('in2', 'outline');
    compOutline.setAttribute('operator', 'in');
    compOutline.setAttribute('result', 'strokeLayer');
    // Fill: mask original shape and color
    const floodFill = document.createElementNS('http://www.w3.org/2000/svg', 'feFlood');
    floodFill.setAttribute('flood-color', color);
    floodFill.setAttribute('result', 'fillColor');
    const compFill = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
    compFill.setAttribute('in', 'fillColor');
    compFill.setAttribute('in2', 'SourceAlpha');
    compFill.setAttribute('operator', 'in');
    compFill.setAttribute('result', 'fillLayer');
    // Merge outline below, fill above
    const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const n1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    n1.setAttribute('in', 'strokeLayer');
    const n2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    n2.setAttribute('in', 'fillLayer');
    merge.appendChild(n1);
    merge.appendChild(n2);
    f.appendChild(morph);
    f.appendChild(floodOutline);
    f.appendChild(compOutline);
    f.appendChild(floodFill);
    f.appendChild(compFill);
    f.appendChild(merge);
    defs.appendChild(f);
  }
  function tone(hex: string, factor: number): string {
    let h = hex.replace('#',''); if (h.length === 3) h = h.split('').map(c=>c+c).join('');
    const r = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(0,2),16) * factor)));
    const g = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(2,4),16) * factor)));
    const b = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(4,6),16) * factor)));
    const toHex = (v: number) => v.toString(16).padStart(2,'0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  makeTintFilter('tint-red', '#d33', tone('#d33', 0.8));
  makeTintFilter('tint-gold', '#f0c419', tone('#f0c419', 0.8));
  makeTintFilter('tint-green', '#2ecc71', tone('#2ecc71', 0.8));
  makeTintFilter('tint-black', '#000', tone('#000', 1.6));
  svg.appendChild(defs);
  svg.appendChild(scene);

  // edges with offsets per unordered pair and dashed style for paths
  function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  const groups: Map<string, { a: string; b: string; kinds: string[] }> = new Map();
  for (const e of Object.values(state.map.edges)) {
    const k = pairKey(e.a, e.b);
    const set = new Set(groups.get(k)?.kinds ?? []);
    (e.kinds ?? []).forEach(kind => set.add(kind));
    groups.set(k, { a: e.a, b: e.b, kinds: Array.from(set) });
  }
  const OFF = 6; // px between parallel edges
  const ROAD_STROKE = '#8b5a2b'; // brown
  const WATER_STROKE = '#2e86de'; // blue
  groups.forEach(({ a, b, kinds }) => {
    const na = state.map.nodes[a];
    const nb = state.map.nodes[b];
    if (!na || !nb) return;
    // Sort so water renders under land
    const order = kinds.slice().sort((x, y) => (x === 'river' ? -1 : 0) - (y === 'river' ? -1 : 0));
    const dx = nb.x - na.x;
    const dy = nb.y - na.y;
    const dist = Math.hypot(dx, dy) || 1e-6;
    const px = -dy / dist, py = dx / dist; // unit perpendicular
    const m = order.length;
    for (let idx = 0; idx < m; idx++) {
      const kind = order[idx];
      const offset = (idx - (m - 1) / 2) * OFF;
      const ox = px * offset, oy = py * offset;
      const x1 = na.x + ox, y1 = na.y + oy;
      const x2 = nb.x + ox, y2 = nb.y + oy;
      if (kind === 'river') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', WATER_STROKE);
        line.setAttribute('stroke-width', '6');
        line.setAttribute('stroke-linecap', 'round');
        mapLayer.appendChild(line);
      } else {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', ROAD_STROKE);
        line.setAttribute('stroke-width', '2');
        if (kind === 'path') {
          line.setAttribute('stroke-dasharray', '6 4');
        }
        mapLayer.appendChild(line);
      }
    }
  });

  // nodes
  // Determine controlling factions per node
  const controllersByNode: Record<string, string[]> = computeControllers(state);

  for (const n of Object.values(state.map.nodes)) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(n.x));
    circle.setAttribute('cy', String(n.y));
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', '#bbb');

    if (state.prompt?.kind === 'selectNode') {
      if (state.prompt.nodeOptions.includes(n.id)) {
        circle.setAttribute('fill', '#7cf');
        circle.style.cursor = 'pointer';
        circle.addEventListener('click', () => handlers.onSelectNode(n.id));
      }
    }

    if (state.prompt?.kind === 'selectAdjacentNode' && state.prompt.nodeOptions.includes(n.id)) {
      circle.setAttribute('fill', '#7cf');
      circle.style.cursor = 'pointer';
      circle.addEventListener('click', () => handlers.onSelectNode(n.id));
    }
    mapLayer.appendChild(circle);

    // Overlay control coloring (faded). Supports any number of controlling factions by slicing the circle.
    const ctrls = controllersByNode[n.id] ?? [];
    if (ctrls.length === 1) {
      const fill = FactionColor[ctrls[0] as keyof typeof FactionColor] ?? '#888';
      const top = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      top.setAttribute('cx', String(n.x));
      top.setAttribute('cy', String(n.y));
      top.setAttribute('r', '10');
      top.setAttribute('fill', fill);
      top.setAttribute('fill-opacity', '0.35');
      mapLayer.appendChild(top);
    } else if (ctrls.length > 1) {
      const k = ctrls.length;
      for (let i = 0; i < k; i++) {
        const c = FactionColor[ctrls[i] as keyof typeof FactionColor] ?? '#888';
        const start = (i / k) * Math.PI * 2;
        const end = ((i + 1) / k) * Math.PI * 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const r = 10;
        const x1 = n.x + r * Math.cos(start);
        const y1 = n.y + r * Math.sin(start);
        const x2 = n.x + r * Math.cos(end);
        const y2 = n.y + r * Math.sin(end);
        const large = end - start > Math.PI ? 1 : 0;
        const d = `M ${n.x} ${n.y} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
        path.setAttribute('d', d);
        path.setAttribute('fill', c);
        path.setAttribute('fill-opacity', '0.35');
        mapLayer.appendChild(path);
      }
    }

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(n.x + 12));
    label.setAttribute('y', String(n.y + 4));
    label.setAttribute('fill', '#222');
    label.textContent = n.label ?? n.id;
    mapLayer.appendChild(label);
  }

  // pieces (group by node and pack into 3-column rows with width-aware packing)
  // Track the top-most pixel of any drawn piece per node for capital placement
  const pieceTopByNode: Record<string, number> = {};
  const byNode: Record<string, Piece[]> = {};
  for (const piece of Object.values(state.pieces)) {
    if (piece.location.kind === 'node') {
      const nid = piece.location.nodeId;
      (byNode[nid] ??= []).push(piece);
    }
  }

  function getPieceWidth(piece: Piece): number {
    const t = (state.pieceTypes as any)[piece.typeId] as { width?: number; shape?: string } | undefined;
    if (t?.width) return t.width;
    // fallback heuristic by id/name if width not provided
    const id = (state.pieceTypes as any)[piece.typeId]?.id?.toLowerCase?.() ?? '';
    const name = (state.pieceTypes as any)[piece.typeId]?.name?.toLowerCase?.() ?? '';
    if (id.includes('ship') || name.includes('ship') || id.includes('capital') || name.includes('capital')) return 3;
    return 1;
  }

  function inferShape(piece: Piece): 'cube' | 'horse' | 'ship' {
    const t = (state.pieceTypes as any)[piece.typeId] as { shape?: string } | undefined;
    const s = (t?.shape ?? 'cube').toLowerCase();
    if (s === 'horse') return 'horse';
    if (s === 'ship') return 'ship';
    return 'cube';
  }

  function isCapitalPiece(piece: Piece): boolean {
    const t = (state.pieceTypes as any)[piece.typeId] as { shape?: string } | undefined;
    const s = (t?.shape ?? '').toLowerCase();
    return s === 'capital' || piece.typeId === 'capital';
  }


  type LayoutItem = { piece: Piece; row: number; col: number; span: number };
  function packPieces3Wide(pieces: Piece[]): LayoutItem[] {
    // Exclude capitals from layout packing; they are drawn as overlays and should not reserve space
    pieces = pieces.filter(p => !isCapitalPiece(p));
    const ones: Piece[] = [];
    const threeShips: Piece[] = [];
    const threeOthers: Piece[] = [];
    for (const p of pieces) {
      if (getPieceWidth(p) >= 3) {
        if (inferShape(p) === 'ship') threeShips.push(p);
        else threeOthers.push(p);
      } else ones.push(p);
    }

    // Build bands with variable heights: 1.0 for full row, 0.5 for a single ship
    type Band = { height: number; items: Array<{ piece: Piece; span: number; col?: number; vslot?: number }>; };
    const bands: Band[] = [];

    // 3-wide non-ships: each takes a full band
    for (const p of threeOthers) bands.push({ height: 1, items: [{ piece: p, span: 3 }] });

    // Pair ships: two ships per full band; leftover single ship takes a half band
    for (let i = 0; i < threeShips.length; ) {
      if (i + 1 < threeShips.length) {
        bands.push({ height: 1, items: [
          { piece: threeShips[i++], span: 3, vslot: 0 },
          { piece: threeShips[i++], span: 3, vslot: 1 },
        ]});
      } else {
        bands.push({ height: 0.5, items: [ { piece: threeShips[i++], span: 3, vslot: 0 } ] });
      }
    }

    // 1-wide pieces: rows of up to 3, centered pattern (2 -> cols 0 & 2, 1 -> col 1)
    for (let i = 0; i < ones.length; ) {
      const remaining = ones.length - i;
      if (remaining >= 3) {
        bands.push({ height: 1, items: [
          { piece: ones[i++], span: 1, col: 0 },
          { piece: ones[i++], span: 1, col: 1 },
          { piece: ones[i++], span: 1, col: 2 },
        ]});
      } else if (remaining === 2) {
        bands.push({ height: 1, items: [
          { piece: ones[i++], span: 1, col: 0 },
          { piece: ones[i++], span: 1, col: 2 },
        ]});
      } else { // 1 remaining
        bands.push({ height: 1, items: [ { piece: ones[i++], span: 1, col: 1 } ] });
      }
    }

    // Convert bands into layout items with fractional row indices; bottom anchored at row 0
    // totalHeight could be used for future vertical metrics
    // const totalHeight = bands.reduce((s, b) => s + b.height, 0);
    const layout: LayoutItem[] = [];
    let cursor = 0; // accumulated height from bottom
    bands.forEach((band) => {
      if (band.height === 1 && band.items.length === 2 && band.items[0].span === 3 && band.items[1].span === 3) {
        // two ships in one band: place at cursor and cursor+0.5
        layout.push({ piece: band.items[0].piece, row: cursor, col: 1, span: 3 });
        layout.push({ piece: band.items[1].piece, row: cursor + 0.5, col: 1, span: 3 });
      } else {
        // all others: place at this band start
        const r = cursor;
        for (const it of band.items) {
          layout.push({ piece: it.piece, row: r, col: it.col ?? 1, span: it.span });
        }
      }
      cursor += band.height;
    });
    return layout;
  }

  for (const [nodeId, pieces] of Object.entries(byNode)) {
    const node = state.map.nodes[nodeId];
    if (!node) continue;
    const layout = packPieces3Wide(pieces);
    if (layout.length === 0) continue;
    const spacing = 14; // pixel spacing between rows
    let minTop = Infinity;
    for (const it of layout) {
      const dy = -it.row * spacing;
      let dx = 0;
      if (it.span === 3) dx = 0; else dx = (it.col - 1) * spacing;
      const slotTopY = node.y * MAP_SCALE - 24 + dy;
      // Estimate visual top of the piece for capital placement
      const shape = inferShape(it.piece);
      const visualTopY = shape === 'ship' ? (slotTopY + (16 - SHIP_H) / 2) : slotTopY;
      if (visualTopY < minTop) minTop = visualTopY;
      drawPieceAt(overlayLayer as unknown as SVGSVGElement, it.piece, state, node.x * MAP_SCALE + dx, slotTopY);
    }
    if (minTop !== Infinity) pieceTopByNode[nodeId] = minTop;
  }

  // Capital markers: derive from pieces of type 'capital' and tint by piece faction
  function factionFilterId(f: string | undefined): string {
    if (f === 'song') return 'tint-red';
    if (f === 'jin') return 'tint-gold';
    if (f === 'daqi') return 'tint-green';
    return 'tint-black';
  }
  const capitals: Array<{ nodeId: string; filterId: string }> = [];
  for (const piece of Object.values(state.pieces)) {
    if (piece.location.kind !== 'node') continue;
    const t = (state.pieceTypes as any)[piece.typeId] as { shape?: string } | undefined;
    const shape = (t?.shape ?? '').toLowerCase();
    if (shape === 'capital' || piece.typeId === 'capital') {
      const fac = piece.faction ?? (piece.ownerId ? state.players.find(p => p.id === piece.ownerId)?.faction : undefined);
      capitals.push({ nodeId: piece.location.nodeId, filterId: factionFilterId(fac) });
    }
  }
  const CAPITAL_SIZE = 48; // ~ three cubes wide (each cube is 16px)
  const CAPITAL_GAP = 0; // pixels between capital bottom and top of piece grid
  for (const cap of capitals) {
    const node = state.map.nodes[cap.nodeId];
    if (!node) continue;
    // Position so the icon is centered horizontally; vertical will be adjusted after load
    const x = node.x * MAP_SCALE - CAPITAL_SIZE / 2;
    // Initial guess; will be snapped after load using measured height
    const y = node.y * MAP_SCALE - 24 - CAPITAL_SIZE - CAPITAL_GAP;

    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('x', String(x));
    img.setAttribute('y', String(y));
    img.setAttribute('width', String(CAPITAL_SIZE));
    // Let height follow intrinsic aspect ratio of the SVG
    img.setAttribute('filter', `url(#${cap.filterId})`);
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // xlink:href for wider compatibility
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/assets/capital.svg');
    img.style.pointerEvents = 'none';
    // After the image loads, align its bottom edge flush with the piece grid
    img.addEventListener('load', () => {
      try {
        const bbox = (img as unknown as SVGGraphicsElement).getBBox();
        const h = bbox?.height ?? CAPITAL_SIZE;
        // If there are pieces, sit capital flush above the topmost piece. Otherwise, sit on the city circle (no gap)
        const topOfStack = pieceTopByNode[cap.nodeId];
        const circleTop = node.y * MAP_SCALE - 10; // node circle radius is 10
        const bottom = (topOfStack !== undefined) ? topOfStack - CAPITAL_GAP : circleTop;
        img.setAttribute('y', String(bottom - h));
      } catch {}
    });
    capitalsLayer.appendChild(img);
  }

  // Player character standees (initials in circular badges), rendered above pieces and capitals
  const charsByNode: Record<string, Array<{ id: string; name: string; playerId: string; faction?: string; portrait?: string }>> = {}
  for (const ch of Object.values((state as any).characters ?? {}) as any[]) {
    if (ch.location?.kind !== 'node') continue;
    (charsByNode[ch.location.nodeId] ??= []).push({ id: ch.id, name: ch.name, playerId: ch.playerId, faction: ch.faction, portrait: ch.portrait });
  }
  function characterOffsets(k: number): number[] {
    // Return x-offsets (px) for k items centered around 0
    const gap = 26;
    if (k <= 1) return [0];
    if (k === 2) return [-gap/2, gap/2];
    const arr: number[] = [];
    const start = -((k - 1) * gap) / 2;
    for (let i = 0; i < k; i++) arr.push(start + i * gap);
    return arr;
  }
  for (const [nodeId, chars] of Object.entries(charsByNode)) {
    const node = state.map.nodes[nodeId];
    if (!node) continue;
    const R = 12; // portrait radius (inner)
    const outerR = R + 2; // include ring stroke radius
    const CHAR_GAP = 2; // pixels between top of stack and bottom of ring
    const topOfStack = pieceTopByNode[nodeId];
    const circleTop = node.y * MAP_SCALE - 10; // top of city circle
    const bottom = (topOfStack !== undefined) ? (topOfStack - CHAR_GAP) : circleTop;
    const centerY = bottom - outerR;
    function factionFromTucked(playerId: string | undefined): string | undefined {
      if (!playerId) return undefined;
      const pl = (state.players as any[]).find(p => p.id === playerId);
      if (!pl || !Array.isArray(pl.tucked)) return undefined;
      for (const card of pl.tucked) {
        const icons = (card && Array.isArray(card.icons)) ? card.icons : [];
        for (const ic of icons) {
          const s = String(ic);
          if (s === 'song' || s === 'jin' || s === 'daqi') return s;
        }
      }
      return undefined;
    }
    const xs = characterOffsets(chars.length);
    chars.forEach((ch, i) => {
      const cx = node.x * MAP_SCALE + xs[i];
      // Border + background
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const facId = factionFromTucked((ch as any).playerId);
      const col = facId ? (FactionColor as any)[facId] ?? '#000' : '#000';
      ring.setAttribute('cx', String(cx));
      ring.setAttribute('cy', String(centerY));
      ring.setAttribute('r', String(outerR));
      ring.setAttribute('fill', '#fff');
      ring.setAttribute('stroke', col);
      ring.setAttribute('stroke-width', '3');
      overlayLayer.appendChild(ring);
      // Initials
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(cx));
      label.setAttribute('y', String(centerY + 4));
      label.setAttribute('fill', '#000');
      label.setAttribute('font-size', '10');
      label.setAttribute('font-weight', '700');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = (ch.name || '?').split(/\s+/).map(s => s[0]).join('').slice(0,2).toUpperCase();
      overlayLayer.appendChild(label);
    });
  }

  // Enable zoom & pan
  svg.style.cursor = 'grab';
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const prevScale = scale;
    const delta = -Math.sign(e.deltaY) * 0.1;
    scale = Math.min(3, Math.max(0.5, scale + delta));
    const k = scale / prevScale;
    tx = mx - k * (mx - tx);
    ty = my - k * (my - ty);
    clampPan();
    applyTransform();
  }, { passive: false });
  let panning = false; let sx = 0; let sy = 0; let stx = 0; let sty = 0;
  svg.addEventListener('mousedown', (e) => {
    panning = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty; svg.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    tx = stx + (e.clientX - sx);
    ty = sty + (e.clientY - sy);
    clampPan();
    applyTransform();
  });
  window.addEventListener('mouseup', () => { if (panning) { panning = false; svg.style.cursor = 'grab'; } });

  return svg as unknown as HTMLElement;
}

function computeControllers(state: GameState): Record<string, string[]> {
  const controllers: Record<string, string[]> = {};
  const landKinds = new Set(['road', 'path']);
  const waterKinds = new Set(['river', 'canal', 'coast', 'lake']);

  // Pieces by node and faction
  const piecesByNode: Record<string, Record<string, number>> = {};
  for (const piece of Object.values(state.pieces)) {
    if (piece.location.kind !== 'node') continue;
    const nodeId = piece.location.nodeId;
    const faction = piece.faction ?? (piece.ownerId ? state.players.find(p => p.id === piece.ownerId)?.faction : undefined);
    if (!faction) continue;
    piecesByNode[nodeId] ??= {};
    piecesByNode[nodeId][faction] = (piecesByNode[nodeId][faction] ?? 0) + 1;
  }

  const playerFactions = Array.from(new Set(Object.values(state.players).map(p => p.faction).filter(Boolean) as string[]));
  const pieceFactions = Array.from(new Set(Object.values(state.pieces).map(pc => (pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined))).filter(Boolean) as string[]));
  const factions = Array.from(new Set([...playerFactions, ...pieceFactions]));

  // Precompute adjacency per piece (one-edge reach) by movement type
  function neighborsByKinds(nodeId: string, kinds: Set<string>): string[] {
    const out: string[] = [];
    for (const e of Object.values(state.map.edges)) {
      if (!e.kinds || e.kinds.length === 0) continue;
      const has = e.kinds.some(k => kinds.has(k));
      if (!has) continue;
      if (e.a === nodeId) out.push(e.b);
      else if (e.b === nodeId) out.push(e.a);
    }
    return out;
  }

  // Index neighbors per node for both land and water
  const landNeighbors: Record<string, string[]> = {};
  const waterNeighbors: Record<string, string[]> = {};
  for (const nid of Object.keys(state.map.nodes)) {
    landNeighbors[nid] = neighborsByKinds(nid, landKinds);
    waterNeighbors[nid] = neighborsByKinds(nid, waterKinds);
  }

  // Pieces grouped by faction
  const piecesByFaction: Record<string, Array<{ nodeId: string; typeId: string }>> = {};
  for (const piece of Object.values(state.pieces)) {
    if (piece.location.kind !== 'node') continue;
    const faction = piece.faction ?? (piece.ownerId ? state.players.find(p => p.id === piece.ownerId)?.faction : undefined);
    if (!faction) continue;
    (piecesByFaction[faction] ??= []).push({ nodeId: piece.location.nodeId, typeId: piece.typeId });
  }

  for (const nodeId of Object.keys(state.map.nodes)) {
    // Rule (1): presence
    const present = piecesByNode[nodeId];
    if (present) {
      controllers[nodeId] = Object.keys(present);
      continue;
    }

    // Rule (2): single-faction adjacency by correct movement type
    const contenders: Set<string> = new Set();
    for (const faction of factions) {
      const ps = piecesByFaction[faction] ?? [];
      let qualifies = false;
      for (const { nodeId: from, typeId } of ps) {
        const isShip = typeId === 'ship';
        const neigh = isShip ? waterNeighbors[from] : landNeighbors[from];
        if (neigh.includes(nodeId)) { qualifies = true; break; }
      }
      if (qualifies) contenders.add(faction);
      if (contenders.size > 1) break;
    }
    if (contenders.size === 1) controllers[nodeId] = Array.from(contenders);
  }

  return controllers;
}

function darken(hex: string, factor: number): string {
  // factor < 1 darkens, > 1 lightens
  let h = hex.replace('#','');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(0,2),16) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(2,4),16) * factor)));
  const b = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(4,6),16) * factor)));
  const toHex = (v: number) => v.toString(16).padStart(2,'0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function drawPieceAt(svg: SVGSVGElement, piece: Piece, state: GameState, x: number, y: number): void {
  if (piece.location.kind !== 'node') return;
  const owner = piece.ownerId ? state.players.find((p) => p.id === piece.ownerId) : undefined;
  const faction = piece.faction ?? owner?.faction;
  const fill = faction ? FactionColor[faction as keyof typeof FactionColor] : (owner?.color ?? '#f44');
  const stroke = faction === 'rebel' ? darken(fill, 1.6) : darken(fill, 0.8);

  const type = (state.pieceTypes as any)[piece.typeId] as { shape?: string; width?: number } | undefined;
  const shape = type?.shape ?? 'cube';

  let el: SVGElement;
  if (shape === 'ship' || (type?.width ?? 1) >= 3) {
    // Long rectangle spanning 3 columns: width = 2*spacing + 16
    const spacing = 14;
    const W = 2 * spacing + 16;
    const H = shape === 'ship' ? SHIP_H : 10;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x - W / 2));
    rect.setAttribute('y', String(y + (16 - H) / 2));
    rect.setAttribute('width', String(W));
    rect.setAttribute('height', String(H));
    rect.setAttribute('rx', '3');
    rect.setAttribute('ry', '3');
    rect.setAttribute('fill', fill);
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', '2');
    // Do not render actual capital rectangles; handled by overlay
    if ((type?.shape ?? '').toLowerCase() === 'capital' || piece.typeId === 'capital') {
      return;
    }
    el = rect;
  } else if (shape === 'horse') {
    // Up-pointing triangle within 16x16 box
    const tri = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const p1 = `${x},${y}`;            // top center
    const p2 = `${x - 8},${y + 16}`;   // bottom left
    const p3 = `${x + 8},${y + 16}`;   // bottom right
    tri.setAttribute('points', `${p1} ${p2} ${p3}`);
    tri.setAttribute('fill', fill);
    tri.setAttribute('stroke', stroke);
    tri.setAttribute('stroke-width', '2');
    el = tri;
  } else {
    // cube (default): 16x16 square centered horizontally, y is top
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x - 8));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', '16');
  rect.setAttribute('height', '16');
    rect.setAttribute('fill', fill);
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', '2');
    el = rect;
  }

  (el as any).setAttribute('data-key', `piece:${piece.id}`);

  if (state.prompt?.kind === 'selectPiece' && state.prompt.pieceIds.includes(piece.id)) {
    (el as any).style.cursor = 'pointer';
    el.setAttribute('stroke', '#ff0');
    el.setAttribute('stroke-width', '2');
    el.addEventListener('click', () => (window as any).onSelectPiece?.(piece.id));
  }

  svg.appendChild(el);
}

// Legacy helper, no longer used

function renderHand(state: GameState, handlers: any): HTMLElement {
  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.alignItems = 'center';
  div.style.justifyContent = 'space-between';
  div.style.gap = '10px';
  div.style.padding = '8px';
  div.style.borderTop = '1px solid #444';
  const player = viewingPlayer(state);
  const center = document.createElement('div');
  center.style.display = 'flex';
  center.style.alignItems = 'center';
  center.style.justifyContent = 'center';
  center.style.gap = '10px';
  for (const card of player.hand) {
    const disabled = !!state.hasPlayedThisTurn;
    const cardEl = renderCard(card, () => handlers.onPlayCard(card.id));
    cardEl.setAttribute('data-key', `card:${getStableCardKey(card)}`);
    if (disabled) {
      cardEl.style.opacity = '0.5';
      (cardEl as any).style.pointerEvents = 'none';
    }
    center.appendChild(cardEl);
  }
  // Left spacer (global draw is in left panel)
  const leftStack = document.createElement('div');
  leftStack.style.width = '100px';
  // Right: tucks and spacer (global discard is in right panel)
  const rightZone = document.createElement('div');
  rightZone.style.display = 'flex';
  rightZone.style.alignItems = 'center';
  rightZone.style.gap = '16px';
  const tucks = renderTuckSplay(player.tucked, 'self');
  tucks.style.zIndex = '2';
  // Player coin inventory
  const coinRow = document.createElement('div');
  coinRow.style.display = 'flex';
  coinRow.style.alignItems = 'center';
  coinRow.style.gap = '6px';
  const coinLbl = document.createElement('div');
  coinLbl.textContent = 'Coins';
  coinLbl.style.fontSize = '12px';
  coinLbl.style.color = '#ccc';
  const coins = renderCoins(player.coins ?? 0);
  coinRow.appendChild(coinLbl);
  coinRow.appendChild(coins);
  rightZone.appendChild(tucks);
  rightZone.appendChild(coinRow);
  div.appendChild(leftStack);
  div.appendChild(center);
  div.appendChild(rightZone);
  return div;
}

function renderPile(label: string, imgPath: string, count: number, size: 'sm' | 'md' = 'md'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '6px';
  const stack = document.createElement('div');
  stack.style.position = 'relative';
  const w = size === 'sm' ? 40 : 70;
  const h = size === 'sm' ? 56 : 98;
  stack.style.width = `${w}px`;
  stack.style.height = `${h}px`;
  for (let i = 0; i < Math.min(count, 3); i++) {
    const img = document.createElement('img');
    img.src = imgPath;
    img.style.position = 'absolute';
    img.style.left = `${i * 2}px`;
    img.style.top = `${-i * 2}px`;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.borderRadius = '6px';
    stack.appendChild(img);
  }
  const lbl = document.createElement('div');
  lbl.textContent = `${label} (${count})`;
  lbl.style.fontSize = '12px';
  lbl.style.color = '#ccc';
  wrap.appendChild(stack);
  wrap.appendChild(lbl);
  return wrap;
}

function renderCard(card: { name: string; asset?: { path: string; size: { width: number; height: number }; iconSlot?: { x: number; y: number; width: number; height: number } } }, onClick: () => void): HTMLElement {
  const w = 150; // tarot scaled width
  const h = Math.round(w * (570 / 330));
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.width = `${w}px`;
  container.style.height = `${h}px`;
  container.style.border = '1px solid #333';
  container.style.borderRadius = '10px';
  container.style.overflow = 'hidden';
  container.style.cursor = 'pointer';
  container.title = card.name;
  // Gesture handling: single-click to play; double-click or long-press to preview
  let clickTimer: number | undefined;
  let longPressTimer: number | undefined;
  let suppressNextClick = false;
  const CLICK_DELAY_MS = 220;
  const LONG_PRESS_MS = 500;

  function clearTimers() {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = undefined; }
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = undefined; }
  }

  container.addEventListener('click', (e) => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      onClick();
      clickTimer = undefined;
    }, CLICK_DELAY_MS) as unknown as number;
  });
  container.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = undefined; }
    showCardPreview(card);
  });
  container.addEventListener('touchstart', () => {
    clearTimers();
    longPressTimer = window.setTimeout(() => {
      suppressNextClick = true;
      showCardPreview(card);
      longPressTimer = undefined;
    }, LONG_PRESS_MS) as unknown as number;
  }, { passive: true });
  const cancelLong = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = undefined; } };
  container.addEventListener('touchend', cancelLong, { passive: true });
  container.addEventListener('touchmove', cancelLong, { passive: true });

  const img = document.createElement('img');
  img.src = card.asset?.path ?? '/vite.svg';
  img.alt = card.name;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.draggable = false;
  container.appendChild(img);

  // Note: Flavor text is baked into the card asset SVG (for print & preview)

  // Always show the icon slot overlay if present
  if (card.asset?.iconSlot) {
    const overlay = document.createElement('div');
    const scale = w / card.asset.size.width;
    overlay.style.position = 'absolute';
    overlay.style.left = `${card.asset.iconSlot.x * scale}px`;
    overlay.style.top = `${card.asset.iconSlot.y * scale}px`;
    overlay.style.width = `${card.asset.iconSlot.width * scale}px`;
    overlay.style.height = `${card.asset.iconSlot.height * scale}px`;
    overlay.style.outline = '2px solid #0006';
    overlay.style.pointerEvents = 'none';
    container.appendChild(overlay);
  }

  return container;
}

function renderOpponents(state: GameState): HTMLElement {
  const bar = document.createElement('div');
  bar.style.display = 'flex';
  bar.style.alignItems = 'center';
  bar.style.justifyContent = 'center';
  bar.style.gap = '16px';
  const viewer = viewingPlayer(state);
  const opponents = state.players.filter((p) => p.id !== viewer.id && p.faction !== 'rebel');
  for (const opp of opponents) {
    const panel = document.createElement('div');
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.alignItems = 'center';
    panel.style.gap = '6px';
    const name = document.createElement('div');
    name.textContent = opp.name;
    name.style.fontSize = '12px';
    name.style.color = '#ddd';
    panel.appendChild(name);
    // Opponent hand: show card backs count
    const hand = document.createElement('div');
    hand.style.display = 'flex';
    hand.style.gap = '4px';
    for (let i = 0; i < Math.min(opp.hand.length, 5); i++) {
      const back = document.createElement('img');
      back.src = '/cards/back.svg';
      back.style.width = '40px';
      back.style.height = '56px';
      back.style.borderRadius = '6px';
      hand.appendChild(back);
    }
    const handLbl = document.createElement('div');
    handLbl.textContent = `(${opp.hand.length})`;
    handLbl.style.fontSize = '12px';
    handLbl.style.color = '#aaa';
    const handWrap = document.createElement('div');
    handWrap.style.display = 'flex';
    handWrap.style.alignItems = 'center';
    handWrap.style.gap = '6px';
    handWrap.appendChild(hand);
    handWrap.appendChild(handLbl);
    panel.appendChild(handWrap);
    // Opponent tucks and coins
    const tucks = renderTuckSplay(opp.tucked, 'opponent');
    const coinRow = document.createElement('div');
    coinRow.style.display = 'flex';
    coinRow.style.alignItems = 'center';
    coinRow.style.gap = '6px';
    const coinLbl = document.createElement('div');
    coinLbl.textContent = 'Coins';
    coinLbl.style.fontSize = '11px';
    coinLbl.style.color = '#aaa';
    const coins = renderCoins(opp.coins ?? 0, 'sm');
    coinRow.appendChild(coinLbl);
    coinRow.appendChild(coins);
    panel.appendChild(tucks);
    panel.appendChild(coinRow);
    bar.appendChild(panel);
  }
  return bar;
}

function renderTuckSplay(cards: any[], orientation: 'self' | 'opponent'): HTMLElement {
  const MAX_ROWS = 8;
  const BAND_HEIGHT = 36; // visible band height per card
  const ROW_OFFSET = 28; // vertical spacing between bands
  const CARD_WIDTH = 150; // full card width
  const COL_GAP = 12;

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';

  // Header with count badge
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.gap = '8px';
  const lbl = document.createElement('div');
  lbl.textContent = 'Tucks';
  lbl.style.fontSize = '12px';
  lbl.style.color = '#ccc';
  const badge = document.createElement('span');
  badge.textContent = String(cards.length);
  badge.style.background = '#444';
  badge.style.color = '#eee';
  badge.style.fontSize = '11px';
  badge.style.padding = '0 6px';
  badge.style.borderRadius = '10px';
  header.appendChild(lbl);
  header.appendChild(badge);
  wrap.appendChild(header);

  const scroll = document.createElement('div');
  scroll.style.overflowX = 'auto';
  scroll.style.paddingBottom = '4px';
  scroll.style.maxWidth = '100%';

  const cols = Math.ceil(cards.length / MAX_ROWS);
  const area = document.createElement('div');
  area.style.position = 'relative';
  area.style.width = `${cols * CARD_WIDTH + (cols - 1) * COL_GAP}px`;
  area.style.height = `${(Math.min(MAX_ROWS, cards.length) - 1) * ROW_OFFSET + BAND_HEIGHT}px`;

  cards.forEach((card, index) => {
    const asset = card.asset;
    const key = `card:${getStableCardKey(card)}`;
    const col = Math.floor(index / MAX_ROWS);
    const row = index % MAX_ROWS;
    const el = document.createElement('div');
    el.setAttribute('data-key', key);
    el.style.position = 'absolute';
    el.style.left = `${col * (CARD_WIDTH + COL_GAP)}px`;
    el.style.top = `${row * ROW_OFFSET}px`;
    el.style.width = `${CARD_WIDTH}px`;
    el.style.height = `${BAND_HEIGHT}px`;
    el.style.overflow = 'hidden';
    el.title = card.name;

    if (!asset || !asset.iconSlot) {
      el.textContent = card.name;
      el.style.border = '1px solid #333';
      el.style.borderRadius = '4px';
      el.style.padding = '4px 8px';
      area.appendChild(el);
    } else {
      const scale = CARD_WIDTH / asset.size.width;
      const displayW = asset.size.width * scale;
      const displayH = asset.size.height * scale;
      const img = document.createElement('img');
      img.src = asset.path;
      img.alt = card.name;
      img.style.width = `${displayW}px`;
      img.style.height = `${displayH}px`;
      img.style.objectFit = 'cover';
      img.draggable = false;
      img.style.transformOrigin = 'top left';
      // Ensure predictable stacking: image below, overlay above
      img.style.position = 'relative';
      img.style.zIndex = '1';

      const tx = -asset.iconSlot.x * scale;
      const ty = -asset.iconSlot.y * scale;
      img.style.transform = `translate(${tx}px, ${ty}px)`;
      if (orientation === 'self') {
        el.style.transform = 'rotate(180deg)';
        el.style.transformOrigin = 'center';
      }

      // Preview gestures for tucked cards
      el.addEventListener('click', () => showCardPreview(card));
      el.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); showCardPreview(card); });
      let __lpTimer: number | undefined;
      const __LP_MS = 500;
      el.addEventListener('touchstart', () => {
        __lpTimer = window.setTimeout(() => { showCardPreview(card); __lpTimer = undefined; }, __LP_MS) as unknown as number;
      }, { passive: true });
      const __cancelLP = () => { if (__lpTimer) { clearTimeout(__lpTimer); __lpTimer = undefined; } };
      el.addEventListener('touchend', __cancelLP, { passive: true });
      el.addEventListener('touchmove', __cancelLP, { passive: true });
      el.appendChild(img);
      area.appendChild(el);
    }
  });

  scroll.appendChild(area);
  wrap.appendChild(scroll);
  return wrap;
}

function showCardPreview(card: any): void {
  if (!card || !card.asset) return;
  const existing = document.getElementById('card-preview-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'card-preview-overlay';
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '9999';
  overlay.addEventListener('click', () => overlay.remove());

  const img = document.createElement('img');
  img.src = card.asset.path;
  img.alt = card.name;
  img.style.maxWidth = '80vw';
  img.style.maxHeight = '80vh';
  img.style.borderRadius = '8px';
  img.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';

  overlay.appendChild(img);
  document.body.appendChild(overlay);
}

function renderCoins(count: number, size: 'sm' | 'md' = 'md'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = size === 'sm' ? '4px' : '6px';
  const r = size === 'sm' ? 6 : 8;
  for (let i = 0; i < Math.min(count, 10); i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(r * 2));
    svg.setAttribute('height', String(r * 2));
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(r));
    c.setAttribute('cy', String(r));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', '#f0c419');
    c.setAttribute('stroke', '#b78900');
    c.setAttribute('stroke-width', '2');
    svg.appendChild(c);
    wrap.appendChild(svg);
  }
  if (count > 10) {
    const more = document.createElement('span');
    more.textContent = `+${count - 10}`;
    more.style.fontSize = size === 'sm' ? '10px' : '12px';
    more.style.color = '#ccc';
    wrap.appendChild(more);
  }
  return wrap;
}


