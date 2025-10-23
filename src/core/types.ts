// Core type definitions for the Card Verb System

export type Id = string;

// Map graph
export type NodeId = Id;
export type EdgeId = Id;

export interface MapNode {
  id: NodeId;
  x: number;
  y: number;
  label?: string;
  kind?: string; // domain-specific e.g., city, town, etc.
}

export interface MapEdge {
  id: EdgeId;
  a: NodeId;
  b: NodeId;
  kinds?: string[]; // e.g., road, river, rail; order not significant
}

export interface MapGraph {
  nodes: Record<NodeId, MapNode>;
  edges: Record<EdgeId, MapEdge>;
}

// Pieces
export type PlayerId = Id;
export type PieceTypeId = Id;
export type PieceId = Id;

export interface PieceType {
  id: PieceTypeId;
  name: string;
  svg?: string; // optional inline SVG path or asset key
  color?: string;
}

export type Location =
  | { kind: 'node'; nodeId: NodeId }
  | { kind: 'edge'; edgeId: EdgeId };

export interface Piece {
  id: PieceId;
  ownerId: PlayerId;
  typeId: PieceTypeId;
  location: Location;
}

// Cards & Decks
export type CardId = Id;
export type IconId = Id;

export interface Card {
  id: CardId;
  name: string;
  icons?: IconId[];
  verbs: VerbSpec[];
  asset?: {
    path: string; // public path to image (e.g., /cards/coin.svg)
    size: { width: number; height: number }; // pixel dimensions of the full card asset
    iconSlot?: { x: number; y: number; width: number; height: number }; // region to show when tucked
  };
  keepOnPlay?: boolean; // if true, card returns to hand after play
}

export interface Deck {
  cards: Card[];
}

// Verb specs
export type VerbSpec =
  | { type: 'draw'; count: number }
  | { type: 'drawUpTo'; limit: number }
  | { type: 'tuck'; target: 'self' | 'opponent' }
  | { type: 'move'; steps?: number }
  | { type: 'recruit'; pieceTypeId: PieceTypeId }
  | { type: 'destroy' }
  | { type: 'endGame'; winner?: 'self' | 'none' };

// Player & Game state
export interface PlayerState {
  id: PlayerId;
  name: string;
  drawPile: Deck;
  discardPile: Deck;
  hand: Card[];
  tucked: Card[]; // cards tucked for icons
  color?: string;
}

export type Prompt =
  | {
      kind: 'selectPiece';
      playerId: PlayerId;
      pieceIds: PieceId[];
      next: { kind: 'forMove'; steps: number } | { kind: 'forDestroy' };
      message: string;
    }
  | {
      kind: 'selectAdjacentNode';
      playerId: PlayerId;
      pieceId: PieceId;
      nodeOptions: NodeId[];
      stepsRemaining: number;
      message: string;
    }
  | {
      kind: 'selectNode';
      playerId: PlayerId;
      nodeOptions: NodeId[];
      next: { kind: 'forRecruit'; pieceTypeId: PieceTypeId };
      message: string;
    };

export interface GameLogEntry {
  message: string;
}

export interface GameState {
  map: MapGraph;
  pieceTypes: Record<PieceTypeId, PieceType>;
  pieces: Record<PieceId, Piece>;
  players: PlayerState[];
  // Whose turn it is (authoritative for game flow)
  currentPlayerId?: PlayerId;
  // Which player perspective the client is viewing (for multiplayer)
  viewPlayerId?: PlayerId;
  // Deprecated legacy field for hotseat; kept for compatibility
  currentPlayerIndex: number;
  // Seating order (clockwise). If absent, uses players[] order.
  seating?: { order: PlayerId[] };
  prompt: Prompt | null;
  gameOver: boolean;
  winnerId?: PlayerId;
  log: GameLogEntry[];
}

export function getPlayerById(state: GameState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

export function getPlayerIndexById(state: GameState, playerId: PlayerId): number {
  return state.players.findIndex((p) => p.id === playerId);
}

export function currentPlayer(state: GameState): PlayerState {
  if (state.currentPlayerId) {
    const p = getPlayerById(state, state.currentPlayerId);
    if (p) return p;
  }
  return state.players[state.currentPlayerIndex];
}

export function viewingPlayer(state: GameState): PlayerState {
  if (state.viewPlayerId) {
    const p = getPlayerById(state, state.viewPlayerId);
    if (p) return p;
  }
  return currentPlayer(state);
}

export function nextPlayerId(state: GameState): PlayerId {
  const order = state.seating?.order ?? state.players.map((p) => p.id);
  const currentId = state.currentPlayerId ?? state.players[state.currentPlayerIndex].id;
  const idx = order.indexOf(currentId);
  const nextIdx = (idx + 1) % order.length;
  return order[nextIdx];
}

export function findAdjacentNodes(map: MapGraph, nodeId: NodeId): NodeId[] {
  const edges = Object.values(map.edges);
  const adjacent: Set<NodeId> = new Set();
  for (const e of edges) {
    if (e.a === nodeId) adjacent.add(e.b);
    else if (e.b === nodeId) adjacent.add(e.a);
  }
  return Array.from(adjacent);
}


