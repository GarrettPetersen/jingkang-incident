import type { GameState, NodeId, Piece } from '../core/types';
import { viewingPlayer } from '../core/types';

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
  svg.setAttribute('viewBox', '0 0 1200 800');
  svg.style.border = '1px solid #555';
  svg.style.background = '#111';
  svg.style.width = '100%';
  svg.style.height = '100%';

  // Color tint filters for capital markers (use SourceAlpha to flood with a color)
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  function makeTintFilter(id: string, color: string) {
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', id);
    const flood = document.createElementNS('http://www.w3.org/2000/svg', 'feFlood');
    flood.setAttribute('flood-color', color);
    flood.setAttribute('result', 'flood');
    const comp = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
    comp.setAttribute('in', 'flood');
    comp.setAttribute('in2', 'SourceAlpha');
    comp.setAttribute('operator', 'in');
    comp.setAttribute('result', 'mask');
    const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    node.setAttribute('in', 'mask');
    merge.appendChild(node);
    f.appendChild(flood);
    f.appendChild(comp);
    f.appendChild(merge);
    defs.appendChild(f);
  }
  makeTintFilter('tint-red', '#d33');
  makeTintFilter('tint-gold', '#f0c419');
  svg.appendChild(defs);

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
  const ROAD_STROKE = '#b89';
  const WATER_STROKE = '#4aa3';
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
        svg.appendChild(line);
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
        svg.appendChild(line);
      }
    }
  });

  // nodes
  for (const n of Object.values(state.map.nodes)) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(n.x));
    circle.setAttribute('cy', String(n.y));
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', '#ddd');

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
    svg.appendChild(circle);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(n.x + 12));
    label.setAttribute('y', String(n.y + 4));
    label.setAttribute('fill', '#eee');
    label.textContent = n.label ?? n.id;
    svg.appendChild(label);
  }

  // pieces (group by node and spread so they don't overlap)
  const byNode: Record<string, Piece[]> = {};
  for (const piece of Object.values(state.pieces)) {
    if (piece.location.kind === 'node') {
      const nid = piece.location.nodeId;
      (byNode[nid] ??= []).push(piece);
    }
  }
  for (const [nodeId, pieces] of Object.entries(byNode)) {
    const node = state.map.nodes[nodeId];
    const count = pieces.length;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const spacing = 14; // pixels between pieces in the grid
    for (let i = 0; i < count; i++) {
      const piece = pieces[i];
      const row = Math.floor(i / cols);
      const col = i % cols;
      const dx = (col - (cols - 1) / 2) * spacing;
      const dy = (row - (rows - 1) / 2) * spacing;
      drawPieceAt(svg, piece, state, node.x + dx, node.y - 24 + dy);
    }
  }

  // Capital markers: render special SVGs at specified cities
  const capitals: Array<{ nodeId: string; filterId: string }> = [
    { nodeId: 'huaiyang', filterId: 'tint-red' },
    { nodeId: 'yanjing', filterId: 'tint-gold' },
  ];
  const CAPITAL_SIZE = 48; // ~ three cubes wide (each cube is 16px)
  const CAPITAL_GAP = 0; // pixels between capital bottom and top of piece grid
  for (const cap of capitals) {
    const node = state.map.nodes[cap.nodeId];
    if (!node) continue;
    // Position so the icon is centered horizontally; vertical will be adjusted after load
    const x = node.x - CAPITAL_SIZE / 2;
    // Start with a conservative guess; we'll snap the bottom flush with the piece grid once loaded
    const y = node.y - 24 - CAPITAL_SIZE - CAPITAL_GAP;

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
        img.setAttribute('y', String(node.y - 24 - CAPITAL_GAP - h));
      } catch {}
    });
    svg.appendChild(img);
  }

  return svg as unknown as HTMLElement;
}

function drawPieceAt(svg: SVGSVGElement, piece: Piece, state: GameState, x: number, y: number): void {
  if (piece.location.kind !== 'node') return;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x - 8));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', '16');
  rect.setAttribute('height', '16');
  const owner = state.players.find((p) => p.id === piece.ownerId);
  rect.setAttribute('fill', owner?.color ?? '#f44');
  (rect as any).setAttribute('data-key', `piece:${piece.id}`);

  // If selecting a piece to move
  if (state.prompt?.kind === 'selectPiece' && state.prompt.pieceIds.includes(piece.id)) {
    rect.style.cursor = 'pointer';
    rect.setAttribute('stroke', '#ff0');
    rect.setAttribute('stroke-width', '2');
    rect.addEventListener('click', () => (window as any).onSelectPiece?.(piece.id));
  }

  svg.appendChild(rect);
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
  const w = 150; // tarot-ish scaled width
  const h = Math.round(w * (420 / 300));
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.width = `${w}px`;
  container.style.height = `${h}px`;
  container.style.border = '1px solid #333';
  container.style.borderRadius = '10px';
  container.style.overflow = 'hidden';
  container.style.cursor = 'pointer';
  container.title = card.name;
  container.addEventListener('click', onClick);

  const img = document.createElement('img');
  img.src = card.asset?.path ?? '/vite.svg';
  img.alt = card.name;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.draggable = false;
  container.appendChild(img);

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
  const opponents = state.players.filter((p) => p.id !== viewer.id);
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

      const tx = -asset.iconSlot.x * scale;
      const ty = -asset.iconSlot.y * scale;
      img.style.transform = `translate(${tx}px, ${ty}px)`;
      if (orientation === 'self') {
        el.style.transform = 'rotate(180deg)';
        el.style.transformOrigin = 'center';
      }

      el.addEventListener('click', () => showCardPreview(card));
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


