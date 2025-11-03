import { draw, mergeDecks, shuffleDeck, pushBottom } from './deck';
import type { Card, Deck, GameState, PlayerId, VerbSpec, NodeId, PieceId } from './types';
import { currentPlayer, findAdjacentNodes, nextPlayerId } from './types';
import type { Effect, Condition, IconId, PlayerSelector, FactionSelector, NodeSelector } from './types';
import type { Effect, Condition, IconId } from './types';

export interface EngineConfig {
  handLimit: number;
}

export const DefaultConfig: EngineConfig = { handLimit: 5 };

let __turnStartSnapshot: GameState | null = null;

function deepCloneState<T>(obj: T): T {
  try {
    // structuredClone is widely available in modern browsers
    return (structuredClone as any)(obj);
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
}

export function getTurnStartSnapshot(): GameState | null {
  return __turnStartSnapshot ? deepCloneState(__turnStartSnapshot) : null;
}

export function startTurn(state: GameState): void {
  state.prompt = null;
  if (!state.currentPlayerId) {
    // Initialize using legacy index for hotseat
    state.currentPlayerId = state.players[state.currentPlayerIndex].id;
  }
  // Save snapshot for undo
  __turnStartSnapshot = deepCloneState(state);
  // In hotseat, keep viewing player synced with current
  state.viewPlayerId = state.currentPlayerId;
  state.hasPlayedThisTurn = false;
  state.lastPlayedCardId = undefined;
  state.hasActedThisTurn = false;
}

export function endTurn(state: GameState): void {
  // Advance authoritative turn owner by seating
  const prevId = state.currentPlayerId ?? state.players[state.currentPlayerIndex].id;
  state.currentPlayerId = nextPlayerId(state);
  // Keep legacy index in sync for hotseat
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === state.currentPlayerId);
  // In hotseat, viewing player follows the turn owner
  state.viewPlayerId = state.currentPlayerId;
  state.prompt = null;
  const prev = state.players.find((p) => p.id === prevId)?.name ?? prevId;
  const next = state.players.find((p) => p.id === state.currentPlayerId)?.name ?? state.currentPlayerId;
  state.log.push({ message: `End turn: ${prev} → ${next}` });
  // Begin next turn and snapshot it
  startTurn(state);
}

export function playCard(state: GameState, cardId: string): void {
  if (state.gameOver) return;
  if (state.hasPlayedThisTurn) {
    state.log.push({ message: `Already played a card this turn.` });
    return;
  }
  const player = currentPlayer(state);
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return;
  const [card] = player.hand.splice(idx, 1);
  state.log.push({ message: `${player.name} plays ${card.name}` });
  if (card.effect) {
    executeEffect(state, player.id, card, card.effect);
  } else {
    for (const verb of card.verbs) {
      if (state.gameOver) break;
      executeVerb(state, player.id, card, verb);
    }
  }
  // Discard or keep (do NOT auto-advance turn; End Turn is user-driven)
  if (!state.gameOver) {
    const tuckedSomewhere = state.players.some((p) => p.tucked.includes(card));
    if (card.keepOnPlay) {
      player.hand.push(card);
    } else if (tuckedSomewhere) {
      // already moved to a tucked stack; do not discard
    } else {
      state.discardPile = pushBottom(state.discardPile, [card]);
    }
    state.hasPlayedThisTurn = true;
    state.hasActedThisTurn = true;
    state.lastPlayedCardId = card.id;
  }
}

// Effect execution (AND/OR/IF) with tucked-icon conditions
function executeEffect(
  state: GameState,
  playerId: PlayerId,
  card: Card,
  effect: Effect,
): void {
  switch (effect.kind) {
    case 'verb': {
      executeVerb(state, playerId, card, effect.verb);
      return;
    }
    case 'all': {
      for (const e of effect.effects) {
        if (state.gameOver) break;
        executeEffect(state, playerId, card, e);
      }
      return;
    }
    case 'any': {
      // TODO: prompt for choice; for now, choose the first available
      const choice = effect.effects[0];
      if (choice) executeEffect(state, playerId, card, choice);
      return;
    }
    case 'if': {
      const ok = evaluateCondition(state, playerId, effect.condition);
      if (ok) executeEffect(state, playerId, card, effect.then);
      else if (effect.else) executeEffect(state, playerId, card, effect.else);
      return;
    }
  }
}

function evaluateCondition(state: GameState, playerId: PlayerId, cond: Condition): boolean {
  switch (cond.kind) {
    case 'hasTuckedIcon': {
      const need = Math.max(1, cond.atLeast ?? 1);
      if (cond.who === 'self') {
        const have = countTuckedIcon(state, playerId, cond.icon);
        return have >= need;
      } else { // 'others'
        for (const p of state.players) {
          if (p.id === playerId) continue;
          const have = countTuckedIcon(state, p.id, cond.icon);
          if (have >= need) return true;
        }
        return false;
      }
    }
  }
}

function countTuckedIcon(state: GameState, playerId: PlayerId, icon: IconId): number {
  const p = state.players.find((pp) => pp.id === playerId);
  if (!p) return 0;
  let c = 0;
  for (const card of p.tucked) {
    const icons = (card?.icons ?? []) as IconId[];
    for (const ic of icons) if (ic === icon) c += 1;
  }
  return c;
}

function executeVerb(
  state: GameState,
  playerId: PlayerId,
  card: Card,
  verb: VerbSpec,
): void {
  switch (verb.type) {
    case 'draw': {
      const targetId = resolvePlayerSelector(state, playerId, verb.target ?? 'self');
      const target = state.players.find((p) => p.id === targetId)!;
      if (state.drawPile.cards.length === 0 && state.discardPile.cards.length > 0) {
        state.drawPile = shuffleDeck(mergeDecks([state.discardPile]));
        state.discardPile = { cards: [] } as Deck;
      }
      const { drawn, deck } = draw(state.drawPile, verb.count);
      state.drawPile = deck;
      target.hand.push(...drawn);
      state.log.push({ message: `${target.name} draws ${drawn.length}` });
      break;
    }
    case 'drawUpTo': {
      const player = state.players.find((p) => p.id === playerId)!;
      const need = Math.max(0, verb.limit - player.hand.length);
      if (need > 0) {
        if (state.drawPile.cards.length < need && state.discardPile.cards.length > 0) {
          state.drawPile = shuffleDeck(mergeDecks([state.discardPile]));
          state.discardPile = { cards: [] } as Deck;
        }
        const { drawn, deck } = draw(state.drawPile, need);
        state.drawPile = deck;
        player.hand.push(...drawn);
        state.log.push({ message: `${player.name} draws ${drawn.length} to ${verb.limit}` });
      }
      break;
    }
    case 'tuck': {
      const self = state.players.find((p) => p.id === playerId)!;
      if (verb.target === 'self') {
        self.tucked.push(card);
        state.log.push({ message: `${self.name} tucks ${card.name}` });
      } else {
        const opp = findOpponent(state, playerId);
        opp.tucked.push(card);
        state.log.push({ message: `${self.name} tucks ${card.name} in front of ${opp.name}` });
      }
      break;
    }
    case 'gainCoin': {
      const self = state.players.find((p) => p.id === playerId)!;
      self.coins = (self.coins ?? 0) + verb.amount;
      state.log.push({ message: `${self.name} gains ${verb.amount} coin(s)` });
      break;
    }
    case 'move': {
      const steps = verb.steps ?? 1;
      // Prompt to select a piece owned by the player
      const movablePieceIds = Object.values(state.pieces)
        .filter((pc) => pc.ownerId === playerId && pc.location.kind === 'node')
        .map((pc) => pc.id);
      state.prompt = {
        kind: 'selectPiece',
        playerId,
        pieceIds: movablePieceIds,
        next: { kind: 'forMove', steps },
        message: 'Select a piece to move',
      };
      break;
    }
    case 'recruit': {
      // Resolve piece type
      const pieceTypeId = (verb as any).pieceTypeId ?? (verb as any).pieceTypes?.anyOf?.[0];
      // Resolve node options
      const nodeOptions = resolveNodeSelector(state, playerId, (verb as any).at) ?? Object.keys(state.map.nodes);
      state.prompt = {
        kind: 'selectNode',
        playerId,
        nodeOptions,
        next: { kind: 'forRecruit', pieceTypeId },
        message: 'Select a node to recruit',
      };
      break;
    }
    case 'destroy': {
      // Select any piece to remove
      const pieceIds = Object.keys(state.pieces);
      state.prompt = {
        kind: 'selectPiece',
        playerId,
        pieceIds,
        next: { kind: 'forDestroy' },
        message: 'Select a piece to destroy',
      };
      break;
    }
    case 'endGame': {
      state.gameOver = true;
      state.winnerId = verb.winner === 'self' ? playerId : undefined;
      state.log.push({ message: `Game ends` });
      break;
    }
  }
}

export function inputSelectPiece(state: GameState, pieceId: PieceId): void {
  if (!state.prompt || state.prompt.kind !== 'selectPiece') return;
  const piece = state.pieces[pieceId];
  if (!piece) return;
  if (state.prompt.next.kind === 'forMove') {
    if (piece.location.kind !== 'node') return;
    const options = findAdjacentNodes(state.map, piece.location.nodeId);
    state.prompt = {
      kind: 'selectAdjacentNode',
      playerId: state.prompt.playerId,
      pieceId,
      nodeOptions: options,
      stepsRemaining: state.prompt.next.steps,
      message: 'Select destination',
    };
  } else if (state.prompt.next.kind === 'forDestroy') {
    delete state.pieces[pieceId];
    state.log.push({ message: `Destroyed piece ${pieceId}` });
    state.prompt = null;
  }
}

export function inputSelectAdjacentNode(state: GameState, nodeId: NodeId): void {
  if (!state.prompt || state.prompt.kind !== 'selectAdjacentNode') return;
  const { pieceId, stepsRemaining } = state.prompt;
  const piece = state.pieces[pieceId];
  if (!piece || piece.location.kind !== 'node') return;
  piece.location = { kind: 'node', nodeId };
  const remaining = stepsRemaining - 1;
  if (remaining > 0) {
    const options = findAdjacentNodes(state.map, nodeId);
    state.prompt = {
      kind: 'selectAdjacentNode',
      playerId: state.prompt.playerId,
      pieceId,
      nodeOptions: options,
      stepsRemaining: remaining,
      message: 'Select next destination',
    };
  } else {
    state.prompt = null;
  }
}

export function inputSelectNode(state: GameState, nodeId: NodeId): void {
  if (!state.prompt || state.prompt.kind !== 'selectNode') return;
  if (!state.map.nodes[nodeId]) return;
  const next = state.prompt.next;
  if (next.kind === 'forRecruit') {
    const pieceId = genId('pc');
    state.pieces[pieceId] = {
      id: pieceId,
      ownerId: state.prompt.playerId,
      typeId: next.pieceTypeId,
      location: { kind: 'node', nodeId },
    };
    state.log.push({ message: `Recruited at ${nodeId}` });
  }
  state.prompt = null;
}

function findOpponent(state: GameState, playerId: PlayerId) {
  const others = state.players.filter((p) => p.id !== playerId);
  return others[0] ?? state.players[0];
}

let __id = 0;
function genId(prefix: string): string {
  __id += 1;
  return `${prefix}-${__id}`;
}

// Helpers for resolving selectors
function resolvePlayerSelector(state: GameState, selfId: PlayerId, sel: PlayerSelector): PlayerId {
  if (sel === 'self') return selfId;
  if (sel === 'opponent') return findOpponent(state, selfId).id;
  return (sel as any).playerId ?? selfId;
}

function resolveFactionSelector(state: GameState, selfId: PlayerId, sel: FactionSelector | undefined): string | undefined {
  if (!sel) return undefined;
  if (sel === 'selfFaction') return state.players.find(p => p.id === selfId)?.faction;
  if (sel === 'opponentFaction') return findOpponent(state, selfId)?.faction;
  return sel;
}

function resolveNodeSelector(state: GameState, selfId: PlayerId, sel: NodeSelector | undefined): string[] | undefined {
  if (!sel) return undefined;
  if ((sel as any).any) return Object.keys(state.map.nodes);
  if ((sel as any).nodes) {
    const ids = (sel as any).nodes as string[];
    return ids.filter(id => !!state.map.nodes[id]);
  }
  if ((sel as any).controlledBy) {
    const faction = resolveFactionSelector(state, selfId, (sel as any).controlledBy);
    if (!faction) return [];
    const byNode: Record<string, Set<string>> = {};
    for (const pc of Object.values(state.pieces)) {
      if (pc.location.kind !== 'node') continue;
      const f = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
      if (!f) continue;
      (byNode[pc.location.nodeId] ??= new Set()).add(f);
    }
    return Object.keys(state.map.nodes).filter(nid => byNode[nid]?.has(faction));
  }
  return undefined;
}


