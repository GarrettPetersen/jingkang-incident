import type { Card, Deck, GameState, Piece, PieceType, PlayerState } from '../core/types';
import { map as boardMap } from '../map/board';

// Use the precomputed full board layout
const map = boardMap;

const pieceTypes: Record<string, PieceType> = {
  cubeRed: { id: 'cubeRed', name: 'Cube (Red)', color: '#d33' },
  cubeBlue: { id: 'cubeBlue', name: 'Cube (Blue)', color: '#33d' },
};

const pieces: Record<string, Piece> = {
  p1: { id: 'p1', ownerId: 'P1', typeId: 'cubeRed', location: { kind: 'node', nodeId: 'hangzhou' } },
  p2: { id: 'p2', ownerId: 'P2', typeId: 'cubeBlue', location: { kind: 'node', nodeId: 'kaifeng' } },
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
const gainCoinCard: Card = {
  id: 'c-coin',
  name: 'Gain Coin',
  icons: [],
  verbs: [{ type: 'gainCoin', amount: 1 }],
  asset: { path: '/cards/coin.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
const tuckOpponentCard: Card = {
  id: 'c-dagger',
  name: 'Dagger',
  icons: ['dagger'],
  verbs: [{ type: 'tuck', target: 'opponent' }],
  asset: { path: '/cards/dagger.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
// Optional end-game card available for future use
const recruitCard: Card = {
  id: 'c-recruit',
  name: 'Recruit',
  verbs: [{ type: 'recruit', pieceTypeId: 'cubeRed' }],
  asset: { path: '/cards/recruit.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
const destroyCard: Card = {
  id: 'c-destroy',
  name: 'Destroy',
  verbs: [{ type: 'destroy' }],
  asset: { path: '/cards/destroy.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};
const redrawCard: Card = {
  id: 'c-redraw',
  name: 'Reform Lines',
  verbs: [{ type: 'drawUpTo', limit: 5 }],
  keepOnPlay: true,
  asset: { path: '/cards/logistics.svg', size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } },
};

// Add multiple coins/daggers for tuck testing
const extraCoins: Card[] = Array.from({ length: 8 }, (_, i) => ({
  ...gainCoinCard,
  id: `c-coin-${i + 1}`,
}));
const extraDaggers: Card[] = Array.from({ length: 8 }, (_, i) => ({
  ...tuckOpponentCard,
  id: `c-dagger-${i + 1}`,
}));

const deck1: Deck = { cards: [
  moveCard,
  drawCard,
  recruitCard,
  destroyCard,
  gainCoinCard,
  tuckOpponentCard,
  ...extraCoins,
  ...extraDaggers,
] };

const players: PlayerState[] = [
  {
    id: 'P1',
    name: 'Player 1',
    hand: [redrawCard],
    tucked: [],
    color: '#d33',
  },
  {
    id: 'P2',
    name: 'Player 2',
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
  drawPile: { cards: [...deck1.cards, ...deck1.cards] },
  discardPile: { cards: [] },
  currentPlayerIndex: 0,
  currentPlayerId: 'P1',
  viewPlayerId: 'P1',
  seating: { order: ['P1', 'P2'] },
  prompt: null,
  gameOver: false,
  log: [],
};


