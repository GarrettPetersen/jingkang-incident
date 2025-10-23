import type {
  Card,
  Deck,
  GameState,
  MapGraph,
  Piece,
  PieceType,
  PlayerState,
} from '../core/types';

const map: MapGraph = {
  nodes: {
    A: { id: 'A', x: 100, y: 100, label: 'A', kind: 'city' },
    B: { id: 'B', x: 280, y: 100, label: 'B', kind: 'city' },
    C: { id: 'C', x: 100, y: 260, label: 'C', kind: 'city' },
    D: { id: 'D', x: 280, y: 260, label: 'D', kind: 'city' },
  },
  edges: {
    AB: { id: 'AB', a: 'A', b: 'B', kinds: ['road'] },
    CD: { id: 'CD', a: 'C', b: 'D', kinds: ['road'] },
    // A and C not directly connected; B and D not connected → tests adjacency
  },
};

const pieceTypes: Record<string, PieceType> = {
  cubeRed: { id: 'cubeRed', name: 'Cube (Red)', color: '#d33' },
  cubeBlue: { id: 'cubeBlue', name: 'Cube (Blue)', color: '#33d' },
};

const pieces: Record<string, Piece> = {
  p1: { id: 'p1', ownerId: 'P1', typeId: 'cubeRed', location: { kind: 'node', nodeId: 'A' } },
  p2: { id: 'p2', ownerId: 'P2', typeId: 'cubeBlue', location: { kind: 'node', nodeId: 'D' } },
};

const moveCard: Card = {
  id: 'c-move',
  name: 'Maneuver',
  icons: [],
  verbs: [{ type: 'move', steps: 1 }],
  asset: { path: '/cards/maneuver.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
const drawCard: Card = {
  id: 'c-draw',
  name: 'Logistics',
  icons: ['coin'],
  verbs: [{ type: 'draw', count: 2 }],
  asset: { path: '/cards/logistics.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
const tuckSelfCard: Card = {
  id: 'c-tuck',
  name: 'Coin',
  icons: ['coin'],
  verbs: [{ type: 'tuck', target: 'self' }],
  asset: { path: '/cards/coin.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
const tuckOpponentCard: Card = {
  id: 'c-dagger',
  name: 'Dagger',
  icons: ['dagger'],
  verbs: [{ type: 'tuck', target: 'opponent' }],
  asset: { path: '/cards/coin.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
// Optional end-game card available for future use
const recruitCard: Card = {
  id: 'c-recruit',
  name: 'Recruit',
  verbs: [{ type: 'recruit', pieceTypeId: 'cubeRed' }],
  asset: { path: '/cards/maneuver.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
const destroyCard: Card = {
  id: 'c-destroy',
  name: 'Destroy',
  verbs: [{ type: 'destroy' }],
  asset: { path: '/cards/endgame.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
const redrawCard: Card = {
  id: 'c-redraw',
  name: 'Reform Lines',
  verbs: [{ type: 'drawUpTo', limit: 5 }],
  keepOnPlay: true,
  asset: { path: '/cards/logistics.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};

const deck1: Deck = { cards: [moveCard, drawCard, recruitCard, destroyCard, tuckSelfCard, tuckOpponentCard] };

const players: PlayerState[] = [
  {
    id: 'P1',
    name: 'Player 1',
    drawPile: { cards: [...deck1.cards] },
    discardPile: { cards: [] },
    hand: [redrawCard],
    tucked: [],
    color: '#d33',
  },
  {
    id: 'P2',
    name: 'Player 2',
    drawPile: { cards: [...deck1.cards] },
    discardPile: { cards: [] },
    hand: [redrawCard],
    tucked: [],
    color: '#33d',
  },
];

export const initialState: GameState = {
  map,
  pieceTypes,
  pieces,
  players,
  currentPlayerIndex: 0,
  currentPlayerId: 'P1',
  viewPlayerId: 'P1',
  seating: { order: ['P1', 'P2'] },
  prompt: null,
  gameOver: false,
  log: [],
};


