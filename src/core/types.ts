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
  // Optional layout/rendering hints
  // width in grid columns (defaults to 1; ships/capitals use 3)
  width?: number;
  // optional semantic shape for renderer
  shape?: 'cube' | 'horse' | 'ship' | 'capital';
}

export type Location =
  | { kind: 'node'; nodeId: NodeId }
  | { kind: 'edge'; edgeId: EdgeId };

export interface Piece {
  id: PieceId;
  // Future: player-character standees may use ownerId; normal forces are faction-owned
  ownerId?: PlayerId;
  faction?: FactionId;
  typeId: PieceTypeId;
  location: Location;
}

// Player Characters (standees)
export type CharacterId = Id;
export interface Character {
  id: CharacterId;
  name: string;
  playerId: PlayerId;
  faction?: FactionId;
  location: { kind: 'node'; nodeId: NodeId };
  portrait?: string; // public path to image asset, e.g. /portraits/yue-fei.svg
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
  // Optional flavor quote rendered on the card face (above the icon slot)
  quote?: {
    text: string;   // localized/translated text to display
    cite?: string;  // brief citation, e.g., "Songshi, Vol. 473"
  };
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
  | { type: 'gainCoin'; amount: number }
  | { type: 'endGame'; winner?: 'self' | 'none' };

// Player & Game state
export interface PlayerState {
  id: PlayerId;
  name: string;
  hand: Card[];
  tucked: Card[]; // cards tucked for icons
  color?: string;
  coins?: number;
  faction?: FactionId;
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
  characters: Record<CharacterId, Character>;
  // Catalog of tuckable tokens (e.g., character control markers, reminders)
  tuckables?: Record<string, Tuckable>;
  players: PlayerState[];
  // Global decks shared by all players
  drawPile: Deck;
  discardPile: Deck;
  // Whose turn it is (authoritative for game flow)
  currentPlayerId?: PlayerId;
  // Which player perspective the client is viewing (for multiplayer)
  viewPlayerId?: PlayerId;
  // Deprecated legacy field for hotseat; kept for compatibility
  currentPlayerIndex: number;
  // Seating order (clockwise). If absent, uses players[] order.
  seating?: { order: PlayerId[] };
  // Enforce one card play per turn
  hasPlayedThisTurn?: boolean;
  lastPlayedCardId?: CardId;
  // Whether the player has taken any action this turn (enables Undo)
  hasActedThisTurn?: boolean;
  prompt: Prompt | null;
  gameOver: boolean;
  winnerId?: PlayerId;
  log: GameLogEntry[];
  diplomacy?: DiplomacyMatrix;
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

// Factions
export type FactionId = 'song' | 'jin' | 'daqi' | 'rebel';

export const FactionColor: Record<FactionId, string> = {
  song: '#d33',   // Song: Red
  jin: '#f0c419', // Jin: Gold
  daqi: '#2ecc71', // Da Qi: Green
  rebel: '#000',  // Rebel: Black
};

// Diplomacy
export type Posture = 'neutral' | 'allied' | 'enemy';
export type DiplomacyMatrix = Record<FactionId, Record<FactionId, Posture>>;
// Tuckable token definitions
export interface Tuckable {
  id: string;
  name: string;
  kind: 'character' | 'token';
  asset?: Card['asset'];
  quote?: Card['quote'];
}



