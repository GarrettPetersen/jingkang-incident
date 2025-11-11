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
  shape?: "cube" | "horse" | "ship" | "capital";
}

export type Location =
  | { kind: "node"; nodeId: NodeId }
  | { kind: "edge"; edgeId: EdgeId }
  | { kind: "offboard" };

export interface Piece {
  id: PieceId;
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
  location: Location;
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
  // Preferred: composable effect tree (AND/OR/IF)
  effect?: Effect;
  // Optional condition that must be true to play the card
  playCondition?: Condition;
  // Optional message to show when playCondition fails
  playConditionMessage?: string;
  // Optional human-readable override for rules text
  rulesTextOverride?: string;
  asset?: {
    path: string; // public path to image (e.g., /cards/coin.svg)
    size: { width: number; height: number }; // pixel dimensions of the full card asset
    iconSlot?: { x: number; y: number; width: number; height: number }; // region to show when tucked
    // Optional card back image (data URL or public path)
    backPath?: string;
  };
  keepOnPlay?: boolean; // if true, card returns to hand after play
  // Optional flavor quote rendered on the card face (above the icon slot)
  quote?: {
    text: string; // localized/translated text to display
    cite?: string; // brief citation, e.g., "Songshi, Vol. 473"
  };
  // Optional short label to render on the card back (e.g., START, EVENT)
  backText?: string;
}

export interface Deck {
  cards: Card[];
}

// Verb specs
// Note: you can add new verbs by extending this union.
export type VerbSpec =
  | { type: "draw"; count: number; target?: PlayerSelector }
  | { type: "drawUpTo"; limit: number }
  | { type: "tuck"; target: "self" | "opponent" }
  | { type: "move"; steps?: number; actingFaction?: FactionSelector }
  | { type: "generalMove"; steps?: number }
  | { type: "shuffleInByBackText"; backText: string }
  | { type: "raid"; actingFaction?: FactionSelector } // destroy an eligible adjacent enemy foot via specific modes
  | { type: "assault"; actingFaction?: FactionSelector } // sacrifice one of your units to destroy an adjacent enemy (mode-specific adjacency)
  | {
      // Destroy up to N pieces at a specific node, optionally filtering by faction (include/exclude) and piece types
      type: "destroyAtNode";
      nodeId: NodeId;
      fromFaction?: FactionSelector; // only this faction
      notFaction?: FactionSelector; // exclude this faction
      pieceTypes?: PieceTypeSelector;
      count?: number;
    }
  | {
      // Force units/characters of targeted factions at a node to retreat to adjacent safe nodes
      type: "retreatAtNode";
      nodeId: NodeId;
      faction?: FactionSelector; // only this faction
      excludeFaction?: FactionSelector; // retreat everyone except this faction
    }
  | {
      type: "recruitAtCapital";
      pieceTypeId: PieceTypeId;
      faction?: FactionSelector;
    }
  | { type: "moveCapital"; steps?: number }
  | { type: "discardFromHand"; excludeStar?: boolean }
  | { type: "discardCardById"; cardId: CardId }
  | { type: "addCardToHand"; cardId: CardId }
  | {
      type: "addCardToPlayerHand";
      cardId: CardId;
      player: PlayerSelector | { playerId: PlayerId };
    }
  | {
      type: "addCardToDrawPile";
      cardId: CardId;
      shuffle?: boolean;
    }
  | {
      type: "discardCardFromPlayerById";
      cardId: CardId;
      player: PlayerSelector | { playerId: PlayerId };
    }
  | {
      type: "trashCardFromPlayerById";
      cardId: CardId;
      player: PlayerSelector | { playerId: PlayerId };
    }
  | {
      // Remove all instances of a card id from anywhere (all hands, all tucked, draw/discard piles)
      type: "trashCardById";
      cardId: CardId;
    }
  | {
      // Remove all instances of a card id from any player's hand/tucked, and from decks
      type: "trashCardByIdAnywhere";
      cardId: CardId;
    }
  | {
      type: "tuckToPlayer";
      player: PlayerSelector | { playerId: PlayerId };
    }
  | {
      // Establish Da Qi: choose a Jin-controlled city (excluding some), place Da Qi base and neighbors
      type: "establishDaqi";
      excludeNodes?: NodeId[];
    }
  | {
      type: "retrieveFromDiscard";
      match?: string;
      target?: "self" | "opponent";
    }
  | {
      type: "recruit";
      pieceTypeId?: PieceTypeId;
      pieceTypes?: PieceTypeSelector;
      at?: NodeSelector;
      // Optional number of times to place; if >1, repeats selection
      count?: number;
      // If true, prevent selecting the same node more than once within this verb
      unique?: boolean;
      // Allow overriding faction used for the placed piece(s)
      faction?: FactionSelector;
      // If provided, exclude these nodes from selectable options (applied after 'at')
      excludeNodes?: NodeId[];
    }
  | { type: "destroy" }
  | {
      type: "destroyNearby";
      // Limit selectable targets to these piece types (anyOf). If omitted, any piece type is eligible
      pieceTypes?: PieceTypeSelector;
      // If true, also allow pieces in the same city as the character (default: false = adjacent only)
      includeCurrentNode?: boolean;
    }
  | {
      // Recruit exactly at the current player's character location
      type: "recruitAtCharacter";
      pieceTypeId: PieceTypeId;
      faction?: FactionSelector;
    }
  | {
      // Remove one matching piece at a specific node without prompting
      type: "removeAt";
      nodeId: NodeId;
      pieceTypeId?: PieceTypeId;
      faction?: FactionSelector;
    }
  | {
      // Convert N pieces at your character's location from one faction to another, preserving type
      type: "convertAtCharacter";
      fromFaction: FactionSelector;
      toFaction: FactionSelector;
      pieceTypes?: PieceTypeSelector;
      count: number;
    }
  | {
      // Destroy up to N pieces at your character's location (optionally filtered)
      type: "destroyAtCharacter";
      fromFaction?: FactionSelector;
      pieceTypes?: PieceTypeSelector;
      count?: number;
    }
  | {
      // Force all pieces and characters of a faction at your character's location to retreat to adjacent cities
      type: "retreatAtCharacter";
      faction: FactionSelector;
    }
  | {
      // Remove a specific tucked card from a player's tuck area and trash it (move to discard)
      type: "trashTuckedCard";
      matchCardId: CardId;
      target?: PlayerSelector;
    }
  | { type: "gainCoin"; amount: number }
  | { type: "endGame"; winner?: "self" | "none" }
  | {
      // Gain coins based on number of tucked icons (e.g., +1 per :admin:)
      type: "gainCoinPerTucked";
      icon: IconId;
      // Optional base amount added regardless of icons (default 0)
      base?: number;
      // Coins per icon (default 1)
      perIcon?: number;
      // Optional maximum total coins granted by this verb
      limit?: number;
    }
  | {
      // Allow the current player to place/move their character to a chosen node
      type: "placeCharacter";
      // Provide explicit options, or use nearCurrent to derive options
      options?: NodeId[];
      nearCurrent?: boolean;
      // If provided, compute adjacency from this anchor node (useful when character starts offboard)
      nearNode?: NodeId;
    };

// Effect composition and conditions (focused on tucked icons)
export type Effect =
  | { kind: "verb"; verb: VerbSpec }
  | { kind: "all"; effects: Effect[] } // sequence / AND
  | { kind: "any"; effects: Effect[] } // choice / OR (UI may prompt later)
  | { kind: "if"; condition: Condition; then: Effect; else?: Effect };

export type Condition =
  | {
      kind: "hasTuckedIcon";
      who: "self" | "others";
      icon: IconId;
      atLeast?: number;
    }
  | {
      // True when the current player's hand has NO card whose title contains '*'
      kind: "noStarCardInHand";
    }
  | {
      // True if the current player has at least this many coins
      kind: "hasCoins";
      atLeast: number;
    }
  | {
      // True if the current player's hand count is at least this number
      kind: "handCountAtLeast";
      atLeast: number;
    }
  | {
      // True if the current player's character is at any of the provided nodes
      kind: "characterAt";
      nodes: NodeId[];
    }
  | {
      // True if the current player's character is in a city that contains a given piece type (optionally faction)
      kind: "characterAtCityWithPiece";
      pieceTypeId: PieceTypeId;
      faction?: FactionSelector;
    }
  | {
      // True if the specified node currently contains a piece of the given faction (presence check)
      kind: "nodeHasFaction";
      nodeId: NodeId;
      faction: FactionSelector;
    }
  | {
      // True if the specified node is controlled by a faction:
      // (a) presence of that faction at the node, OR
      // (b) exactly one adjacent contender by movement type, and it is that faction
      kind: "nodeControlledBy";
      nodeId: NodeId;
      faction: FactionSelector;
    }
  | {
      // True if at least N nodes from the provided set are controlled by a faction
      kind: "nodesControlledAtLeast";
      nodes: NodeId[];
      faction: FactionSelector;
      atLeast: number;
    };

// Selectors and parameter helpers for verb arguments
export type PlayerSelector =
  | "self"
  | "opponent"
  | { playerId: PlayerId }
  | { controllerOfCharacterId: CharacterId };

export type FactionSelector = FactionId | "selfFaction" | "opponentFaction";

export type PieceTypeSelector = { anyOf: PieceTypeId[] };

export type NodeSelector =
  | { nodes: NodeId[] }
  | { controlledBy: FactionSelector }
  | { any: true };

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
      kind: "selectPiece";
      playerId: PlayerId;
      pieceIds: PieceId[];
      next:
        | { kind: "forMove"; steps: number; actingFaction?: FactionId }
        | { kind: "forDestroy" }
        | { kind: "forAssaultSelectTarget"; fromPieceId: PieceId }
        | { kind: "forAssaultResolve"; fromPieceId: PieceId };
      message: string;
    }
  | {
      // General-move convoy selection after choosing destination
      kind: "selectConvoy";
      playerId: PlayerId;
      originNodeId: NodeId;
      destinationNodeId: NodeId;
      // Whether the origin→destination is reachable by these modes
      allowLand: boolean;
      allowWater: boolean;
      // Piece options available to convoy (friendly pieces at origin)
      options: PieceId[];
      // Currently selected pieces to convoy
      selected: PieceId[];
      // If true, confirmation requires at least one selected ship
      requireShipForWater?: boolean;
      message: string;
    }
  | {
      kind: "selectAdjacentNode";
      playerId: PlayerId;
      pieceId: PieceId;
      nodeOptions: NodeId[];
      stepsRemaining: number;
      controlFaction?: FactionId;
      message: string;
    }
  | {
      kind: "selectNode";
      playerId: PlayerId;
      nodeOptions: NodeId[];
      next:
        | {
            kind: "forRecruit";
            pieceTypeId: PieceTypeId;
            remaining?: number;
            unique?: boolean;
            faction?: FactionId;
          }
        | { kind: "forPlaceCharacter"; characterId: CharacterId }
        | {
            kind: "forGeneralMove";
            characterId: CharacterId;
            fromNode: NodeId;
            steps: number;
          }
        | { kind: "forMoveCapital"; fromNode: NodeId }
        | { kind: "forEstablishDaqi" };
      message: string;
    }
  | {
      kind: "choose";
      playerId: PlayerId;
      choices: Effect[]; // UI will describe each effect as a label
      message?: string;
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
  // Card currently being played (for UI lift and sequencing)
  playingCardId?: CardId;
  playingCard?: Card;
  // Pending effect queue to resume after prompts
  pending?: { playerId: PlayerId; card: Card; queue: Effect[] } | null;
  gameOver: boolean;
  winnerId?: PlayerId;
  log: GameLogEntry[];
  diplomacy?: DiplomacyMatrix;
}

export function getPlayerById(
  state: GameState,
  playerId: PlayerId
): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

export function getPlayerIndexById(
  state: GameState,
  playerId: PlayerId
): number {
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
  const currentId =
    state.currentPlayerId ?? state.players[state.currentPlayerIndex].id;
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
export type FactionId = "song" | "jin" | "daqi" | "rebel";

export const FactionColor: Record<FactionId, string> = {
  song: "#d33", // Song: Red
  jin: "#f0c419", // Jin: Gold
  daqi: "#2ecc71", // Da Qi: Green
  rebel: "#000", // Rebel: Black
};

// Diplomacy
export type Posture = "neutral" | "allied" | "enemy";
export type DiplomacyMatrix = Record<FactionId, Record<FactionId, Posture>>;
// Tuckable token definitions
export interface Tuckable {
  id: string;
  name: string;
  kind: "character" | "token";
  asset?: Card["asset"];
  quote?: Card["quote"];
}
