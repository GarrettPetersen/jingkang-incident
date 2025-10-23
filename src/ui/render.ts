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

function runFLIP(root: HTMLElement, viewerId: string): void {
  const current: Map<string, { el: HTMLElement; rect: DOMRect }> = new Map();
  root.querySelectorAll<HTMLElement>('[data-key]')
    .forEach((el) => {
      const key = el.getAttribute('data-key');
      if (!key) return;
      current.set(key, { el, rect: el.getBoundingClientRect() });
    });

  const drawPileKey = `pile:draw:${viewerId}`;
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
  runFLIP(root, viewingPlayer(state).id);
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

  return div;
}

function renderRightPanel(state: GameState): HTMLElement {
  const div = document.createElement('div');
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
  svg.setAttribute('viewBox', '0 0 600 400');
  svg.style.border = '1px solid #555';
  svg.style.background = '#111';
  svg.style.width = '100%';
  svg.style.height = '100%';

  // edges
  for (const e of Object.values(state.map.edges)) {
    const a = state.map.nodes[e.a];
    const b = state.map.nodes[e.b];
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    line.setAttribute('stroke', e.kinds?.includes('river') ? '#4aa3' : '#aaa');
    line.setAttribute('stroke-width', e.kinds?.includes('river') ? '6' : '2');
    svg.appendChild(line);
  }

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

function renderTuckedCardIcon(card: { asset?: { path: string; size: { width: number; height: number }; iconSlot?: { x: number; y: number; width: number; height: number } }; name: string }): HTMLElement {
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.width = '126px'; // display width for icon slot (scale of 0.5 for 252)
  container.style.height = '36px';
  container.style.overflow = 'hidden';
  container.style.border = '1px solid #333';
  container.style.borderRadius = '4px';
  container.title = card.name;

  const asset = card.asset;
  if (!asset || !asset.iconSlot) {
    // fallback: simple label
    container.textContent = card.name;
    container.style.padding = '4px 8px';
    return container;
  }

  const scaleX = 126 / asset.iconSlot.width; // fit icon slot width to container
  const scaleY = 36 / asset.iconSlot.height;
  const scale = Math.min(scaleX, scaleY);
  const displayW = asset.size.width * scale;
  const displayH = asset.size.height * scale;
  const offsetX = -asset.iconSlot.x * scale;
  const offsetY = -asset.iconSlot.y * scale;

  const img = document.createElement('img');
  img.src = asset.path;
  img.alt = card.name;
  img.style.width = `${displayW}px`;
  img.style.height = `${displayH}px`;
  img.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  img.style.objectFit = 'cover';
  img.draggable = false;
  container.appendChild(img);
  return container;
}

function renderHand(state: GameState, handlers: any): HTMLElement {
  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.alignItems = 'center';
  div.style.justifyContent = 'center';
  div.style.gap = '10px';
  div.style.padding = '8px';
  div.style.borderTop = '1px solid #444';
  const player = viewingPlayer(state);
  for (const card of player.hand) {
    const disabled = !!state.hasPlayedThisTurn;
    const cardEl = renderCard(card, () => handlers.onPlayCard(card.id));
    cardEl.setAttribute('data-key', `card:${getStableCardKey(card)}`);
    if (disabled) {
      cardEl.style.opacity = '0.5';
      (cardEl as any).style.pointerEvents = 'none';
    }
    div.appendChild(cardEl);
  }
  // Show draw/discard piles at edges of the hand row
  const leftStack = renderPile('Draw', '/cards/back.svg', player.drawPile.cards.length);
  leftStack.setAttribute('data-key', `pile:draw:${player.id}`);
  const rightStack = renderPile('Discard', '/cards/back.svg', player.discardPile.cards.length);
  rightStack.setAttribute('data-key', `pile:discard:${player.id}`);
  leftStack.style.marginRight = 'auto';
  rightStack.style.marginLeft = 'auto';
  const tucks = renderTuckStack(player.tucked);
  tucks.style.marginLeft = '16px';
  div.prepend(leftStack);
  div.append(tucks);
  div.append(rightStack);
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
    // Opponent piles
    const piles = document.createElement('div');
    piles.style.display = 'flex';
    piles.style.gap = '12px';
    const oppDraw = renderPile('Draw', '/cards/back.svg', opp.drawPile.cards.length, 'sm');
    oppDraw.setAttribute('data-key', `pile:draw:${opp.id}`);
    const oppDiscard = renderPile('Discard', '/cards/back.svg', opp.discardPile.cards.length, 'sm');
    oppDiscard.setAttribute('data-key', `pile:discard:${opp.id}`);
    piles.appendChild(oppDraw);
    piles.appendChild(oppDiscard);
    panel.appendChild(piles);
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
    // Opponent tucks: show icon strips
    const tucks = document.createElement('div');
    tucks.style.display = 'flex';
    tucks.style.gap = '4px';
    for (const card of opp.tucked) {
      const icon = renderTuckedCardIcon(card);
      icon.setAttribute('data-key', `card:${getStableCardKey(card)}`);
      icon.style.width = '84px';
      icon.style.height = '24px';
      panel.appendChild(icon);
    }
    bar.appendChild(panel);
  }
  return bar;
}

function renderTuckStack(cards: any[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  const lbl = document.createElement('div');
  lbl.textContent = `Tucks (${cards.length})`;
  lbl.style.fontSize = '12px';
  lbl.style.color = '#ccc';
  wrap.appendChild(lbl);
  const stack = document.createElement('div');
  stack.style.display = 'flex';
  stack.style.flexDirection = 'column';
  stack.style.gap = '6px';
  for (const card of cards) {
    const el = renderTuckedCardIcon(card);
    el.setAttribute('data-key', `card:${getStableCardKey(card)}`);
    stack.appendChild(el);
  }
  wrap.appendChild(stack);
  return wrap;
}


