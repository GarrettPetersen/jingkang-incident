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
    B: { id: 'B', x: 300, y: 120, label: 'B', kind: 'city' },
    C: { id: 'C', x: 200, y: 280, label: 'C', kind: 'town' },
  },
  edges: {
    AB: { id: 'AB', a: 'A', b: 'B', kinds: ['road'] },
    BC: { id: 'BC', a: 'B', b: 'C', kinds: ['road'] },
    CA: { id: 'CA', a: 'C', b: 'A', kinds: ['river'] },
  },
};

const pieceTypes: Record<string, PieceType> = {
  cubeRed: { id: 'cubeRed', name: 'Cube (Red)', color: '#d33' },
};

const pieces: Record<string, Piece> = {
  p1: { id: 'p1', ownerId: 'P1', typeId: 'cubeRed', location: { kind: 'node', nodeId: 'A' } },
};

const moveCard: Card = { id: 'c-move', name: 'Maneuver', icons: [], verbs: [{ type: 'move', steps: 1 }] };
const drawCard: Card = { id: 'c-draw', name: 'Logistics', icons: ['coin'], verbs: [{ type: 'draw', count: 2 }] };
const tuckCard: Card = { id: 'c-tuck', name: 'Coin', icons: ['coin'], verbs: [{ type: 'tuckSelf' }] };
const endCard: Card = { id: 'c-end', name: 'Proclaim Victory', verbs: [{ type: 'endGame', winner: 'self' }] };

const deck1: Deck = { cards: [moveCard, drawCard, tuckCard, endCard] };

const players: PlayerState[] = [
  {
    id: 'P1',
    name: 'Player 1',
    drawPile: { cards: [...deck1.cards] },
    discardPile: { cards: [] },
    hand: [...deck1.cards],
    tucked: [],
    color: '#d33',
  },
  {
    id: 'P2',
    name: 'Player 2',
    drawPile: { cards: [...deck1.cards] },
    discardPile: { cards: [] },
    hand: [...deck1.cards],
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


