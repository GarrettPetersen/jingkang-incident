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
}

export interface Deck {
  cards: Card[];
}

// Verb specs
export type VerbSpec =
  | { type: 'draw'; count: number }
  | { type: 'tuckSelf' }
  | { type: 'move'; steps?: number }
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
      next: { kind: 'forMove'; steps: number };
      message: string;
    }
  | {
      kind: 'selectAdjacentNode';
      playerId: PlayerId;
      pieceId: PieceId;
      nodeOptions: NodeId[];
      stepsRemaining: number;
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
  currentPlayerIndex: number;
  prompt: Prompt | null;
  gameOver: boolean;
  winnerId?: PlayerId;
  log: GameLogEntry[];
}

export function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex];
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


