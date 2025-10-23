import type { GameState, NodeId, Piece } from '../core/types';
import { viewingPlayer } from '../core/types';

export function renderApp(root: HTMLElement, state: GameState, handlers: {
  onPlayCard: (cardId: string) => void;
  onSelectPiece: (pieceId: string) => void;
  onSelectNode: (nodeId: NodeId) => void;
  onEndTurn: () => void;
  onUndo: () => void;
}): void {
  root.innerHTML = '';

  const container = document.createElement('div');
  container.style.display = 'grid';
  container.style.gridTemplateRows = '1fr 180px';
  container.style.gridTemplateColumns = '240px 1fr 240px';
  container.style.gridTemplateAreas = `
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

  root.appendChild(container);
}

function renderLeftPanel(state: GameState, _handlers: any): HTMLElement {
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
  endBtn.onclick = () => (window as any).onEndTurn?.();
  const undoBtn = document.createElement('button');
  undoBtn.textContent = 'Undo Turn';
  undoBtn.onclick = () => (window as any).onUndo?.();
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
  {
    const h = document.createElement('h3');
    h.textContent = 'Tucked';
    div.appendChild(h);
    const viewer = viewingPlayer(state);
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '6px';
    for (const card of viewer.tucked) {
      const icon = renderTuckedCardIcon(card);
      wrap.appendChild(icon);
    }
    div.appendChild(wrap);
  }

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
    if (disabled) {
      cardEl.style.opacity = '0.5';
      (cardEl as any).style.pointerEvents = 'none';
    }
    div.appendChild(cardEl);
  }
  return div;
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


