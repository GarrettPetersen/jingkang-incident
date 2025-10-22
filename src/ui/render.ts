import type { GameState, NodeId, Piece } from '../core/types';
import { viewingPlayer } from '../core/types';

export function renderApp(root: HTMLElement, state: GameState, handlers: {
  onPlayCard: (cardId: string) => void;
  onSelectPiece: (pieceId: string) => void;
  onSelectNode: (nodeId: NodeId) => void;
}): void {
  root.innerHTML = '';

  const container = document.createElement('div');
  container.style.display = 'grid';
  container.style.gridTemplateColumns = '280px 1fr 280px';
  container.style.gap = '16px';

  container.appendChild(renderLeftPanel(state, handlers));
  container.appendChild(renderBoard(state, handlers));
  container.appendChild(renderRightPanel(state));

  root.appendChild(container);
}

function renderLeftPanel(state: GameState, handlers: any): HTMLElement {
  const div = document.createElement('div');
  const player = viewingPlayer(state);
  const h = document.createElement('h3');
  h.textContent = `Hand - ${player.name}`;
  div.appendChild(h);
  const ul = document.createElement('ul');
  for (const c of player.hand) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = c.name;
    btn.onclick = () => handlers.onPlayCard(c.id);
    li.appendChild(btn);
    ul.appendChild(li);
  }
  div.appendChild(ul);

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
  const h = document.createElement('h3');
  h.textContent = 'Log';
  div.appendChild(h);
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

  // pieces
  for (const piece of Object.values(state.pieces)) {
    drawPiece(svg, piece, state);
  }

  return svg as unknown as HTMLElement;
}

function drawPiece(svg: SVGSVGElement, piece: Piece, state: GameState): void {
  if (piece.location.kind !== 'node') return; // for now only show node pieces
  const node = state.map.nodes[piece.location.nodeId];
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(node.x - 8));
  rect.setAttribute('y', String(node.y - 24));
  rect.setAttribute('width', '16');
  rect.setAttribute('height', '16');
  const owner = state.players.find((p) => p.id === piece.ownerId);
  rect.setAttribute('fill', owner?.color ?? '#f44');

  // If selecting a piece to move
  if (state.prompt?.kind === 'selectPiece' && state.prompt.pieceIds.includes(piece.id)) {
    rect.style.cursor = 'pointer';
    rect.setAttribute('stroke', '#ff0');
    rect.setAttribute('stroke-width', '2');
    rect.addEventListener('click', () => {
      // delegate to caller via custom event style handler
      (window as any).onSelectPiece?.(piece.id);
    });
  }

  svg.appendChild(rect);
}


