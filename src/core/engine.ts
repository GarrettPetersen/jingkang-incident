import { draw, mergeDecks, shuffleDeck, pushBottom } from './deck';
import type { Card, Deck, GameState, PlayerId, VerbSpec, NodeId, PieceId } from './types';
import { currentPlayer, findAdjacentNodes, nextPlayerId } from './types';
import type { Effect, Condition, IconId, PlayerSelector, FactionSelector, NodeSelector } from './types';

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
  state.pending = null as any;
  state.playingCardId = undefined;
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

function parseWarIcon(tok: string): [string, string] | null {
  const s = String(tok).toLowerCase();
  const parts = s.includes(':') ? s.split(':') : s.split('-');
  if (parts[0] !== 'war') return null;
  if (parts.length < 3) return null;
  return [parts[1], parts[2]];
}

function recomputeDiplomacyFromTucked(state: GameState): void {
  // Reset to neutral baseline among known factions
  const factions = new Set<string>();
  for (const p of state.players) if (p.faction) factions.add(String(p.faction));
  for (const pc of Object.values(state.pieces)) if (pc.faction) factions.add(String(pc.faction));
  for (const a of factions) {
    (state.diplomacy as any)[a] = (state.diplomacy as any)[a] || {};
    for (const b of factions) (state.diplomacy as any)[a][b] = 'neutral';
  }
  // Apply war icons from any tucked card
  for (const p of state.players) {
    for (const c of p.tucked) {
      const icons = ((c as any).icons || []) as string[];
      for (const ic of icons) {
        const war = parseWarIcon(ic);
        if (war) {
          const [a, b] = war;
          if ((state.diplomacy as any)[a]) {
            (state.diplomacy as any)[a][b] = 'enemy';
          }
          if ((state.diplomacy as any)[b]) {
            (state.diplomacy as any)[b][a] = 'enemy';
          }
        }
      }
    }
  }
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

// Character control via tucked per-character icons
function slugifyNameToIconToken(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function getControlledCharacter(state: GameState, playerId: PlayerId) {
  const p = state.players.find(pp => pp.id === playerId);
  if (!p) return undefined;
  const tuckedIcons: string[] = [];
  for (const card of p.tucked) {
    const arr = (card?.icons ?? []) as any[];
    for (const ic of arr) tuckedIcons.push(String(ic));
  }
  for (const ch of Object.values(state.characters)) {
    const token = slugifyNameToIconToken(ch.name);
    if (tuckedIcons.includes(token)) return ch;
  }
  return undefined;
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
  const card = player.hand[idx];
  // Generic per-card play condition
  try {
    const cond = (card as any).playCondition as any;
    if (cond) {
      let ok = true;
      ok = evaluateCondition(state, player.id, cond as any, card);
      if (!ok) {
        const msg = ((card as any).playConditionMessage as string) || `Cannot play ${card.name} now.`;
        state.log.push({ message: `${player.name}: ${msg}` });
        return;
      }
    }
  } catch {}
  // Remove from hand now that checks pass
  player.hand.splice(idx, 1);
  state.log.push({ message: `${player.name} plays ${card.name}` });
  state.playingCardId = card.id;
  (state as any).playingCard = card;
  if (card.effect) {
    executeEffect(state, player.id, card, card.effect);
  } else {
    for (const verb of card.verbs) {
      if (state.gameOver) break;
      executeVerb(state, player.id, card, verb);
      if (state.prompt) {
        // pause and queue remaining implicit verbs
        const remaining = card.verbs.slice(card.verbs.indexOf(verb) + 1).map((v) => ({ kind: 'verb', verb: v } as any));
        state.pending = { playerId: player.id, card, queue: remaining as any };
        break;
      }
    }
  }
  // Finalize only if no prompt/pending remains
  if (!state.gameOver && !state.prompt && !(state.pending && state.pending.queue && state.pending.queue.length)) {
    finalizeCardPlay(state, player.id, card);
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
      // If a prompt is opened by the verb, pause here (parent will queue if needed)
      return;
    }
    case 'all': {
      for (let i = 0; i < effect.effects.length; i++) {
        const e = effect.effects[i];
        if (state.gameOver) break;
        executeEffect(state, playerId, card, e);
        if (state.prompt) {
          const rest = effect.effects.slice(i + 1);
          state.pending = { playerId, card, queue: rest as any };
          break;
        }
      }
      return;
    }
    case 'any': {
      // Prompt the player to choose one of the effects; UI will handle labeling
      state.prompt = { kind: 'choose', playerId, choices: effect.effects, message: 'Choose one:' } as any;
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

function evaluateCondition(state: GameState, playerId: PlayerId, cond: Condition, currentCard?: any): boolean {
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
    case 'noStarCardInHand': {
      const p = state.players.find(pp => pp.id === playerId);
      if (!p) return false;
      return !p.hand
        .filter((c: any) => !currentCard || c?.id !== currentCard?.id)
        .some((c: any) => typeof c?.name === 'string' && c.name.includes('*'));
    }
    case 'hasCoins': {
      const p = state.players.find(pp => pp.id === playerId);
      if (!p) return false;
      return (p.coins ?? 0) >= Math.max(0, cond.atLeast);
    }
    case 'characterAt': {
      const ch = getControlledCharacter(state, playerId);
      if (!ch) return false;
      return cond.nodes.includes(ch.location.nodeId);
    }
    case 'characterAtCityWithPiece': {
      const ch = getControlledCharacter(state, playerId);
      if (!ch) return false;
      const here = ch.location.nodeId;
      return Object.values(state.pieces).some((pc) => pc.location.kind === 'node' && pc.location.nodeId === here && pc.typeId === cond.pieceTypeId && (!cond.faction || pc.faction === (cond.faction as any)));
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
  function factionOfPiece(state: GameState, pc: any): string | undefined {
    if (pc.faction) return String(pc.faction);
    if (pc.ownerId) {
      const owner = state.players.find((p) => p.id === pc.ownerId);
      return owner?.faction ? String(owner.faction) : undefined;
    }
    return undefined;
  }
  function isEnemyPiece(state: GameState, selfId: PlayerId, pc: any): boolean {
    // Never allow destroying own piece
    if (pc.ownerId && pc.ownerId === selfId) return false;
    const self = state.players.find((p) => p.id === selfId);
    const selfFaction = self?.faction ? String(self.faction) : undefined;
    const otherFaction = factionOfPiece(state, pc);
    if (!selfFaction || !otherFaction) return false;
    const dip = state.diplomacy as any;
    if (dip && dip[selfFaction] && dip[selfFaction][otherFaction]) {
      return dip[selfFaction][otherFaction] === 'enemy';
    }
    // Fallback: treat different factions as enemies
    return selfFaction !== otherFaction;
  }
  switch (verb.type) {
    case 'addCardToHand': {
      const self = state.players.find((p) => p.id === playerId)!;
      const catalog = (state as any).cardCatalog as Record<string, any> | undefined;
      const src = catalog?.[verb.cardId];
      if (src) {
        // shallow clone is fine for Card
        const cardCopy = { ...(src as any) };
        self.hand.push(cardCopy);
        state.log.push({ message: `${self.name} adds a card to hand.` });
      } else {
        state.log.push({ message: `Card ${verb.cardId} not found.` });
      }
      break;
    }
    case 'retrieveFromDiscard': {
      const self = state.players.find((p) => p.id === playerId)!;
      const match = String((verb as any).match ?? 'dagger').toLowerCase();
      // If targeting an opponent and there are multiple, prompt to choose
      if ((verb as any).target === 'opponent') {
        const selfFaction = self.faction;
        let candidates = state.players.filter((p) => p.id !== playerId);
        const enemyOnly = candidates.filter((p) => selfFaction && p.faction && p.faction !== selfFaction);
        if (enemyOnly.length > 0) candidates = enemyOnly;
        if (candidates.length > 1) {
          state.prompt = {
            kind: 'choose',
            playerId,
            choices: candidates.map((p) => ({
              kind: 'verb',
              verb: { type: 'retrieveFromDiscard', match, target: { playerId: p.id } as any } as VerbSpec,
            })) as any,
            message: 'Choose a player to tuck the retrieved card in front of:',
          } as any;
          return;
        }
      }
      const targetId = resolvePlayerSelector(state, playerId, (verb as any).target ?? 'self');
      const target = state.players.find((p) => p.id === targetId)!;
      const idx = state.discardPile.cards.findIndex((c: any) => String(c?.name || c?.id || '').toLowerCase().includes(match));
      if (idx >= 0) {
        const [card] = state.discardPile.cards.splice(idx, 1);
        target.tucked.push(card);
        state.log.push({ message: `${self.name} retrieves ${card.name || 'a card'} and tucks it in front of ${target.name}` });
      } else {
        state.log.push({ message: `${self.name} finds no matching card in discard.` });
      }
      break;
    }
    case 'draw': {
      // If drawing for an opponent and there are multiple enemy players, prompt to choose
      if ((verb as any).target === 'opponent') {
        const self = state.players.find((p) => p.id === playerId)!;
        const selfFaction = self.faction;
        let candidates = state.players.filter((p) => p.id !== playerId);
        const enemyOnly = candidates.filter((p) => selfFaction && p.faction && p.faction !== selfFaction);
        if (enemyOnly.length > 0) candidates = enemyOnly;
        if (candidates.length > 1) {
          state.prompt = {
            kind: 'choose',
            playerId,
            choices: candidates.map((p) => ({
              kind: 'verb',
              verb: { type: 'draw', count: (verb as any).count, target: { playerId: p.id } as any } as VerbSpec,
            })) as any,
            message: 'Choose an enemy to draw:',
          } as any;
          return;
        }
      }
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
      recomputeDiplomacyFromTucked(state);
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
      let nodeOptions = resolveNodeSelector(state, playerId, (verb as any).at) ?? Object.keys(state.map.nodes);
      const excludes: string[] = Array.isArray((verb as any).excludeNodes) ? (verb as any).excludeNodes : [];
      if (excludes.length > 0) nodeOptions = nodeOptions.filter((n) => !excludes.includes(n));
      // Determine repeats and faction override
      const remaining = Math.max(1, Number((verb as any).count ?? 1));
      const faction = resolveFactionSelector(state, playerId, (verb as any).faction);
      const unique = !!(verb as any).unique;
      const pieceName = String(pieceTypeId);
      const facLabel = faction ? ` (${faction})` : '';
      state.prompt = {
        kind: 'selectNode',
        playerId,
        nodeOptions,
        next: { kind: 'forRecruit', pieceTypeId, remaining, unique, faction: (faction as any) },
        message: remaining > 1 ? `Select a city to place ${pieceName}${facLabel} (${remaining} left)` : `Select a city to place ${pieceName}${facLabel}`,
      };
      break;
    }
    case 'placeCharacter': {
      // Find the current player's character (first one)
      const ch = getControlledCharacter(state, playerId);
      if (!ch) { state.log.push({ message: `No character to place.` }); break; }
      let options: string[] | undefined;
      if ((verb as any).options && Array.isArray((verb as any).options)) {
        options = ((verb as any).options as string[]).filter((nid) => !!state.map.nodes[nid]);
      } else if ((verb as any).nearCurrent && ch.location && (ch.location as any).kind === 'node') {
        const here = (ch.location as any).nodeId as string;
        const adj = findAdjacentNodes(state.map, here);
        // include current and all adjacents
        options = [here, ...adj];
      } else if ((verb as any).nearNode && state.map.nodes[(verb as any).nearNode]) {
        const here = String((verb as any).nearNode);
        const adj = findAdjacentNodes(state.map, here);
        options = [here, ...adj];
      } else {
        options = Object.keys(state.map.nodes);
      }
      state.prompt = {
        kind: 'selectNode',
        playerId,
        nodeOptions: options!,
        next: { kind: 'forPlaceCharacter', characterId: ch.id },
        message: 'Select a city for your character',
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
    case 'destroyNearby': {
      // Find player's character to derive adjacency
      const ch = getControlledCharacter(state, playerId);
      if (!ch) { state.log.push({ message: `No character to target from.` }); break; }
      const here = ch.location.nodeId;
      const adj = findAdjacentNodes(state.map, here);
      const nodes = (verb as any).includeCurrentNode ? [here, ...adj] : adj;
      const allowedTypes: string[] | undefined = (verb as any).pieceTypes?.anyOf;
      const eligible = Object.values(state.pieces)
        .filter((pc) => pc.location.kind === 'node' && nodes.includes(pc.location.nodeId))
        .filter((pc) => !allowedTypes || allowedTypes.includes(pc.typeId))
        // Only enemy pieces per diplomacy matrix (or faction inequality fallback)
        .filter((pc) => isEnemyPiece(state, playerId, pc))
        .map((pc) => pc.id);
      if (eligible.length === 0) {
        state.log.push({ message: `No eligible adjacent enemy targets.` });
        break;
      }
      state.prompt = {
        kind: 'selectPiece',
        playerId,
        pieceIds: eligible,
        next: { kind: 'forDestroy' },
        message: 'Select an adjacent enemy to destroy',
      };
      break;
    }
    case 'recruitAtCharacter': {
      const ch = getControlledCharacter(state, playerId);
      if (!ch) { state.log.push({ message: `No character to recruit at.` }); break; }
      const faction = resolveFactionSelector(state, playerId, (verb as any).faction);
      placePiece(state, playerId, verb.pieceTypeId, ch.location.nodeId, faction as any);
      break;
    }
    case 'removeAt': {
      const nodeId = String((verb as any).nodeId);
      const pieceTypeId = (verb as any).pieceTypeId ? String((verb as any).pieceTypeId) : undefined;
      const faction = resolveFactionSelector(state, playerId, (verb as any).faction);
      const matchId = Object.entries(state.pieces).find(([id, pc]) =>
        pc.location.kind === 'node' && pc.location.nodeId === nodeId && (!pieceTypeId || pc.typeId === pieceTypeId) && (!faction || pc.faction === (faction as any))
      )?.[0];
      if (matchId) {
        delete state.pieces[matchId];
      } else {
        state.log.push({ message: `No matching piece to remove at ${nodeId}.` });
      }
      break;
    }
    case 'convertAtCharacter': {
      const ch = getControlledCharacter(state, playerId);
      if (!ch) { state.log.push({ message: `No character to convert at.` }); break; }
      const here = ch.location.nodeId;
      const fromF = resolveFactionSelector(state, playerId, (verb as any).fromFaction);
      const toF = resolveFactionSelector(state, playerId, (verb as any).toFaction);
      if (!toF) { state.log.push({ message: `No target faction to convert to.` }); break; }
      const allowedTypes: string[] | undefined = (verb as any).pieceTypes?.anyOf;
      const count = Math.max(0, Number((verb as any).count ?? 0));
      const elig = Object.values(state.pieces)
        .filter(pc => pc.location.kind === 'node' && pc.location.nodeId === here)
        .filter(pc => (!fromF || pc.faction === (fromF as any)))
        .filter(pc => !allowedTypes || allowedTypes.includes(pc.typeId));
      const take = elig.slice(0, count);
      for (const pc of take) {
        pc.faction = toF as any;
      }
      if (take.length > 0) {
        state.log.push({ message: `Converted ${take.length} piece(s) at ${here} to ${String(toF)}.` });
      }
      break;
    }
    case 'destroyAtCharacter': {
      const ch = getControlledCharacter(state, playerId);
      if (!ch) { state.log.push({ message: `No character to destroy at.` }); break; }
      const here = ch.location.nodeId;
      const fromF = resolveFactionSelector(state, playerId, (verb as any).fromFaction);
      const allowedTypes: string[] | undefined = (verb as any).pieceTypes?.anyOf;
      let count = Math.max(1, Number((verb as any).count ?? 1));
      const ids = Object.values(state.pieces)
        .filter(pc => pc.location.kind === 'node' && pc.location.nodeId === here)
        .filter(pc => (!fromF || pc.faction === (fromF as any)))
        .filter(pc => !allowedTypes || allowedTypes.includes(pc.typeId))
        .map(pc => pc.id);
      for (const id of ids) {
        if (count <= 0) break;
        delete state.pieces[id];
        count -= 1;
      }
      break;
    }
    case 'retreatAtCharacter': {
      const ch = getControlledCharacter(state, playerId);
      if (!ch) { state.log.push({ message: `No character to retreat from.` }); break; }
      const here = ch.location.nodeId;
      const faction = resolveFactionSelector(state, playerId, (verb as any).faction);
      if (!faction) { state.log.push({ message: `No faction to retreat.` }); break; }

      // Helper: classify edges
      function adjacentByMode(nodeId: string, mode: 'water' | 'land'): string[] {
        const nodes = new Set<string>();
        for (const e of Object.values(state.map.edges)) {
          const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
          const isWater = kinds.includes('river') || kinds.includes('water') || kinds.includes('sea');
          if (mode === 'water' && !isWater) continue;
          if (mode === 'land' && isWater) continue;
          if (e.a === nodeId) nodes.add(e.b);
          else if (e.b === nodeId) nodes.add(e.a);
        }
        // Fallback to any adjacency if no typed edges
        if (nodes.size === 0) return findAdjacentNodes(state.map, nodeId);
        return Array.from(nodes);
      }
      function isSafeNode(nodeId: string, fac: any): boolean {
        for (const pc of Object.values(state.pieces)) {
          if (pc.location.kind !== 'node') continue;
          if (pc.location.nodeId !== nodeId) continue;
          // Unsafe if any piece of a different faction is present
          if ((pc.faction ?? undefined) !== fac) return false;
        }
        return true;
      }
      // Retreat units first (excluding any that are not of target faction)
      const pcsHere = Object.values(state.pieces).filter(pc => pc.location.kind === 'node' && pc.location.nodeId === here && (pc.faction ?? undefined) === faction);
      for (const pc of pcsHere) {
        const mode: 'water' | 'land' = pc.typeId === 'ship' ? 'water' : 'land';
        const adj = adjacentByMode(here, mode);
        const dest = adj.find(n => isSafeNode(n, faction));
        if (dest) {
          pc.location = { kind: 'node', nodeId: dest };
        } else {
          // No safe adjacent — destroy the unit
          delete state.pieces[pc.id];
        }
      }
      // Retreat characters of that faction at the same location (excluding the acting character)
      for (const cc of Object.values(state.characters)) {
        if (cc.id === ch.id) continue;
        if (cc.location.kind !== 'node') continue;
        if (cc.location.nodeId !== here) continue;
        const owner = state.players.find(p => p.id === cc.playerId);
        const cf = cc.faction ?? owner?.faction;
        if (cf !== faction) continue;
        // Try adjacent safe (land mode for characters by default)
        const adj = adjacentByMode(here, 'land');
        const destAdj = adj.find(n => isSafeNode(n, faction));
        if (destAdj) { cc.location = { kind: 'node', nodeId: destAdj } as any; continue; }
        // Try capital
        const capital = Object.values(state.pieces).find(pc => pc.typeId === 'capital' && (pc.faction ?? undefined) === faction);
        if (capital && capital.location.kind === 'node' && isSafeNode(capital.location.nodeId, faction)) {
          cc.location = { kind: 'node', nodeId: capital.location.nodeId } as any; continue;
        }
        // Try any safe space anywhere
        const anySafe = Object.keys(state.map.nodes).find(nid => isSafeNode(nid, faction));
        if (anySafe) { cc.location = { kind: 'node', nodeId: anySafe } as any; continue; }
        // Eliminated: no safe spaces
        cc.location = { kind: 'offboard' } as any;
      }
      break;
    }
    case 'trashTuckedCard': {
      const targetId = resolvePlayerSelector(state, playerId, (verb as any).target ?? 'self');
      const target = state.players.find(p => p.id === targetId)!;
      const matchId = String((verb as any).matchCardId);
      let removed: any[] = [];
      if (Array.isArray(target.tucked)) {
        const keep: any[] = [];
        for (const c of target.tucked) {
          if ((c as any).id === matchId) {
            removed.push(c);
          } else {
            keep.push(c);
          }
        }
        (target as any).tucked = keep;
      }
      if (removed.length > 0) {
        state.discardPile = pushBottom(state.discardPile, removed as any);
        state.log.push({ message: `Trashed ${removed.length} tucked card(s).` });
      }
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
    resumePendingIfAny(state);
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
    resumePendingIfAny(state);
  }
}

export function inputChoose(state: GameState, index: number): void {
  if (!state.prompt || state.prompt.kind !== 'choose') return;
  const { playerId, choices } = state.prompt as any;
  state.prompt = null;
  const card = (state as any).playingCard as any;
  const eff = Array.isArray(choices) ? choices[index] : undefined;
  if (eff) {
    executeEffect(state, playerId, card, eff);
    if (!state.prompt) resumePendingIfAny(state);
  } else {
    resumePendingIfAny(state);
  }
}

export function inputSelectNode(state: GameState, nodeId: NodeId): void {
  if (!state.prompt || state.prompt.kind !== 'selectNode') return;
  if (!state.map.nodes[nodeId]) return;
  const next = state.prompt.next;
  if (next.kind === 'forRecruit') {
    const pieceId = genId('pc');
    const ownerId = state.prompt.playerId;
    const ownerFaction = state.players.find((p) => p.id === ownerId)?.faction;
    state.pieces[pieceId] = {
      id: pieceId,
      ownerId,
      faction: next.faction ?? (ownerFaction as any),
      typeId: next.pieceTypeId,
      location: { kind: 'node', nodeId },
    };
    const label = (state.map.nodes as any)[nodeId]?.label ?? nodeId;
    const rem = Math.max(0, (next.remaining ?? 1) - 1);
    const playerName = state.players.find((p) => p.id === ownerId)?.name ?? ownerId;
    const fac = next.faction ?? (ownerFaction as any);
    const facName = fac ? (String(fac).charAt(0).toUpperCase() + String(fac).slice(1)) : '';
    const ptName = (state.pieceTypes as any)[next.pieceTypeId]?.name ?? String(next.pieceTypeId);
    const unitLabel = `${facName} ${String(ptName).toLowerCase()}`.trim();
    state.log.push({ message: `${playerName} recruited ${unitLabel} at ${label}` });
    if (rem > 0) {
      const opts = next.unique ? state.prompt.nodeOptions.filter((n) => n !== nodeId) : state.prompt.nodeOptions;
      const pieceName = String(next.pieceTypeId);
      const facLabel = next.faction ? ` (${next.faction})` : '';
      state.prompt = {
        kind: 'selectNode',
        playerId: state.prompt.playerId,
        nodeOptions: opts,
        next: { kind: 'forRecruit', pieceTypeId: next.pieceTypeId, remaining: rem, unique: next.unique, faction: next.faction },
        message: `Select a city to place ${pieceName}${facLabel} (${rem} left)`,
      };
    } else {
      state.prompt = null;
      resumePendingIfAny(state);
    }
  } else if ((next as any).kind === 'forPlaceCharacter') {
    const chId = (next as any).characterId as string;
    const ch = state.characters[chId];
    if (ch) {
      ch.location = { kind: 'node', nodeId } as any;
      const label = (state.map.nodes as any)[nodeId]?.label ?? nodeId;
      state.log.push({ message: `Placed ${ch.name} at ${label}` });
    }
    state.prompt = null;
    resumePendingIfAny(state);
  }
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

function resumePendingIfAny(state: GameState) {
  if (!state.pending) return;
  const { playerId, card } = state.pending;
  // If there is a queued list, play the next effect
  while (!state.prompt && state.pending && state.pending.queue && state.pending.queue.length > 0) {
    const nextEffect = state.pending.queue.shift()! as any as Effect;
    executeEffect(state, playerId, card, nextEffect);
    if (state.prompt) return; // paused again
  }
  // If no prompt and no more queue, finalize the card play
  if (!state.prompt) {
    finalizeCardPlay(state, playerId, card);
    state.pending = null as any;
  }
}

function finalizeCardPlay(state: GameState, playerId: PlayerId, card: Card) {
  const player = state.players.find((p) => p.id === playerId)!;
  const tuckedSomewhere = state.players.some((pl) => pl.tucked.includes(card));
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
  state.playingCardId = undefined;
  (state as any).playingCard = undefined;
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


