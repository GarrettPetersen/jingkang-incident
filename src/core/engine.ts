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

// Helpers promoted to file scope for reuse across handlers
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
    case 'handCountAtLeast': {
      const p = state.players.find(pp => pp.id === playerId);
      if (!p) return false;
      return (p.hand?.length ?? 0) >= Math.max(0, cond.atLeast);
    }
    case 'characterAt': {
      const ch = getControlledCharacter(state, playerId);
      if (!ch || ch.location.kind !== 'node') return false;
      return cond.nodes.includes(ch.location.nodeId);
    }
    case 'characterAtCityWithPiece': {
      const ch = getControlledCharacter(state, playerId);
      if (!ch || ch.location.kind !== 'node') return false;
      const here = ch.location.nodeId;
      return Object.values(state.pieces).some((pc) => pc.location.kind === 'node' && pc.location.nodeId === here && pc.typeId === cond.pieceTypeId && (!cond.faction || pc.faction === (cond.faction as any)));
    }
    case 'nodeHasFaction': {
      const faction = resolveFactionSelector(state, playerId, (cond as any).faction);
      if (!faction) return false;
      const nodeId = (cond as any).nodeId;
      return Object.values(state.pieces).some((pc) => {
        if (pc.location.kind !== 'node') return false;
        if (pc.location.nodeId !== nodeId) return false;
        const pf = pc.faction ?? (pc.ownerId ? state.players.find((p) => p.id === pc.ownerId)?.faction : undefined);
        return pf === faction;
      });
    }
    case 'nodeControlledBy': {
      const faction = resolveFactionSelector(state, playerId, (cond as any).faction);
      if (!faction) return false;
      const nodeId = (cond as any).nodeId as string;
      return __nodeControlledByFaction(state, nodeId, faction);
    }
    case 'nodesControlledAtLeast': {
      const faction = resolveFactionSelector(state, playerId, (cond as any).faction);
      if (!faction) return false;
      const nodes = Array.isArray((cond as any).nodes) ? ((cond as any).nodes as string[]) : [];
      const need = Math.max(0, Number((cond as any).atLeast ?? 0));
      let count = 0;
      for (const nid of nodes) {
        if (__nodeControlledByFaction(state, nid, faction)) count += 1;
        if (count >= need) return true;
      }
      return false;
    }
  }
}

// Helper: determine if a node is controlled by a faction per presence or exclusive adjacency
function __nodeControlledByFaction(state: GameState, nodeId: string, faction: string | undefined): boolean {
  if (!faction) return false;
  // Presence at node by faction
  const present = Object.values(state.pieces).some((pc) => {
    if (pc.location.kind !== 'node') return false;
    if (pc.location.nodeId !== nodeId) return false;
    const pf = pc.faction ?? (pc.ownerId ? state.players.find((p) => p.id === pc.ownerId)?.faction : undefined);
    return pf === faction;
  });
  if (present) return true;
  // Else, exclusive adjacency by movement mode
  const landKinds = new Set(['road', 'path']);
  const waterKinds = new Set(['river', 'canal', 'coast', 'lake']);
  function neighborsByKinds(nid: string, kinds: Set<string>): string[] {
    const out: string[] = [];
    for (const e of Object.values(state.map.edges)) {
      if (!e.kinds || e.kinds.length === 0) continue;
      const has = e.kinds.some((k) => kinds.has(k));
      if (!has) continue;
      if (e.a === nid) out.push(e.b);
      else if (e.b === nid) out.push(e.a);
    }
    return out;
  }
  const factions = Array.from(
    new Set(
      Object.values(state.players)
        .map((p) => p.faction)
        .concat(
          Object.values(state.pieces).map((pc) =>
            pc.faction ?? (pc.ownerId ? state.players.find((p) => p.id === pc.ownerId)?.faction : undefined)
          ) as any
        )
    )
  ).filter(Boolean) as string[];
  const contenders: Set<string> = new Set();
  for (const fac of factions) {
    let qualifies = false;
    for (const pc of Object.values(state.pieces)) {
      if (pc.location.kind !== 'node') continue;
      const pf = pc.faction ?? (pc.ownerId ? state.players.find((p) => p.id === pc.ownerId)?.faction : undefined);
      if (pf !== fac) continue;
      const from = pc.location.nodeId;
      const isShip = pc.typeId === 'ship';
      const neigh = isShip ? neighborsByKinds(from, waterKinds) : neighborsByKinds(from, landKinds);
      if (neigh.includes(nodeId)) {
        qualifies = true;
        break;
      }
    }
    if (qualifies) {
      contenders.add(fac);
      if (contenders.size > 1) break;
    }
  }
  return contenders.size === 1 && contenders.has(faction);
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
    case 'destroyAtNode': {
      const nodeId = String((verb as any).nodeId);
      const fromF = resolveFactionSelector(state, playerId, (verb as any).fromFaction);
      const notF = resolveFactionSelector(state, playerId, (verb as any).notFaction);
      const allowed: string[] | undefined = (verb as any).pieceTypes?.anyOf;
      const ids = Object.values(state.pieces)
        .filter(pc => pc.location.kind === 'node' && pc.location.nodeId === nodeId)
        .filter(pc => !allowed || allowed.includes(pc.typeId))
        .filter(pc => (fromF ? pc.faction === (fromF as any) : true))
        .filter(pc => (notF ? pc.faction !== (notF as any) : true))
        .map(pc => pc.id);
      const max = Math.max(1, Number((verb as any).count ?? 1));
      if (ids.length === 0) break;
      if (ids.length <= max) {
        for (const id of ids.slice(0, max)) delete state.pieces[id];
        break;
      }
      // Prompt to choose one if multiple
      state.prompt = {
        kind: 'selectPiece',
        playerId,
        pieceIds: ids,
        next: { kind: 'forDestroy' },
        message: 'Select a piece to destroy',
      };
      break;
    }
    case 'retreatAtNode': {
      const nodeId = String((verb as any).nodeId);
      const onlyF = resolveFactionSelector(state, playerId, (verb as any).faction);
      const excludeF = resolveFactionSelector(state, playerId, (verb as any).excludeFaction);
      function adjacentByMode(nid: string, mode: 'water' | 'land'): string[] {
        const nodes = new Set<string>();
        for (const e of Object.values(state.map.edges)) {
          const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
          const isWater = kinds.includes('river') || kinds.includes('water') || kinds.includes('sea') || kinds.includes('canal') || kinds.includes('lake');
          if (mode === 'water' && !isWater) continue;
          if (mode === 'land' && isWater) continue;
          if (e.a === nid) nodes.add(e.b);
          else if (e.b === nid) nodes.add(e.a);
        }
        if (nodes.size === 0) return findAdjacentNodes(state.map, nid);
        return Array.from(nodes);
      }
      function isSafeNode(nid: string, fac: any): boolean {
        for (const pc of Object.values(state.pieces)) {
          if (pc.location.kind !== 'node') continue;
          if (pc.location.nodeId !== nid) continue;
          const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
          if (pf && pf !== fac) return false;
        }
        return true;
      }
      // Pieces at node — collect retreat choices
      const pcsHere = Object.values(state.pieces).filter(pc => pc.location.kind === 'node' && pc.location.nodeId === nodeId);
      const chooseQueue: Array<{ id: string; options: string[]; faction: any }> = [];
      for (const pc of pcsHere) {
        const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
        if (onlyF && pf !== onlyF) continue;
        if (excludeF && pf === excludeF) continue;
        const mode: 'water' | 'land' = pc.typeId === 'ship' ? 'water' : 'land';
        const adj = adjacentByMode(nodeId, mode).filter(n => isSafeNode(n, pf));
        if (adj.length === 0) {
          // No safe adjacent — destroy the unit
          delete state.pieces[pc.id];
        } else if (adj.length === 1) {
          // Single option — auto move
          pc.location = { kind: 'node', nodeId: adj[0] };
        } else {
          chooseQueue.push({ id: pc.id, options: adj, faction: pf });
        }
      }
      // Characters at node — retain existing auto behavior for now
      // Characters at node
      for (const cc of Object.values(state.characters)) {
        if (cc.location.kind !== 'node' || cc.location.nodeId !== nodeId) continue;
        const owner = state.players.find(p => p.id === cc.playerId);
        const cf = cc.faction ?? owner?.faction;
        if (onlyF && cf !== onlyF) continue;
        if (excludeF && cf === excludeF) continue;
        const adj = adjacentByMode(nodeId, 'land');
        const destAdj = adj.find(n => isSafeNode(n, cf));
        if (destAdj) { cc.location = { kind: 'node', nodeId: destAdj } as any; continue; }
        const capital = Object.values(state.pieces).find(pc => pc.typeId === 'capital' && (pc.faction ?? undefined) === cf);
        if (capital && capital.location.kind === 'node' && isSafeNode(capital.location.nodeId, cf)) {
          cc.location = { kind: 'node', nodeId: capital.location.nodeId } as any; continue;
        }
        const anySafe = Object.keys(state.map.nodes).find(nid => isSafeNode(nid, cf));
        if (anySafe) { cc.location = { kind: 'node', nodeId: anySafe } as any; continue; }
        cc.location = { kind: 'offboard' } as any;
      }
      // If there are player choices, prompt sequentially
      if (chooseQueue.length > 0) {
        const first = chooseQueue.shift()!;
        (state as any).__retreat = { nodeId, queue: chooseQueue };
        state.prompt = {
          kind: 'selectAdjacentNode',
          playerId,
          pieceId: first.id,
          nodeOptions: first.options,
          stepsRemaining: 1,
          controlFaction: first.faction as any,
          message: 'Choose retreat destination',
        } as any;
        return;
      }
      break;
    }
    case 'raid': {
      // Eligible enemy foot adjacent to your foot/horse by road-only, or adjacent to your ship by water
      const self = state.players.find((p) => p.id === playerId)!;
      const selfFaction = self.faction;
      const actingFaction = resolveFactionSelector(state, playerId, (verb as any).actingFaction) ?? selfFaction;
      function neighborsByKinds(nodeId: string, kinds: Set<string>): string[] {
        const nodes = new Set<string>();
        for (const e of Object.values(state.map.edges)) {
          const ekinds = (e.kinds || []).map(k => String(k).toLowerCase());
          const match = ekinds.some(k => kinds.has(k));
          if (!match) continue;
          if (e.a === nodeId) nodes.add(e.b);
          else if (e.b === nodeId) nodes.add(e.a);
        }
        return Array.from(nodes);
      }
      const roadOnly = new Set(['road']); // exclude 'path'
      const waterKinds = new Set(['river','canal','coast','lake','water','sea']);
      // Collect adjacent nodes from any qualifying own unit
      const adjTargets = new Set<string>();
      for (const pc of Object.values(state.pieces)) {
        const pf = pc.faction ?? (pc.ownerId ? state.players.find(p=>p.id===pc.ownerId)?.faction : undefined);
        const owned = actingFaction ? (pf === actingFaction) : (pc.ownerId === playerId || (!!selfFaction && pf === selfFaction));
        if (!owned) continue;
        if (pc.location.kind !== 'node') continue;
        const from = pc.location.nodeId;
        if (pc.typeId === 'ship') {
          neighborsByKinds(from, waterKinds).forEach(n => adjTargets.add(n));
        } else if (pc.typeId === 'foot' || pc.typeId === 'horse') {
          neighborsByKinds(from, roadOnly).forEach(n => adjTargets.add(n));
        }
      }
      // Eligible enemy foot pieces in those adjacent nodes
      const eligible = Object.values(state.pieces)
        .filter(pc => pc.location.kind === 'node' && adjTargets.has(pc.location.nodeId))
        .filter(pc => pc.typeId === 'foot')
        .filter(pc => actingFaction ? ((pc.faction ?? undefined) !== actingFaction) : isEnemyPiece(state, playerId, pc))
        .map(pc => pc.id);
      if (eligible.length === 0) { state.log.push({ message: `No eligible raid targets.` }); break; }
      state.prompt = {
        kind: 'selectPiece',
        playerId,
        pieceIds: eligible,
        next: { kind: 'forDestroy' },
        message: 'Select an adjacent enemy foot to destroy (Raid)',
      };
      break;
    }
    case 'assault': {
      // First choose one of your units to sacrifice (own piece or same-faction)
      const self = state.players.find((p) => p.id === playerId)!;
      const selfFaction = self.faction;
      const actingFaction = resolveFactionSelector(state, playerId, (verb as any).actingFaction) ?? selfFaction;
      const ownIds = Object.values(state.pieces)
        .filter(pc => {
          const pf = pc.faction ?? (pc.ownerId ? state.players.find(p=>p.id===pc.ownerId)?.faction : undefined);
          const owned = actingFaction ? (pf === actingFaction) : (pc.ownerId === playerId || (!!selfFaction && pf === selfFaction));
          return owned && pc.location.kind === 'node';
        })
        .map(pc => pc.id);
      if (ownIds.length === 0) { state.log.push({ message: `No unit to sacrifice for assault.` }); break; }
      state.prompt = {
        kind: 'selectPiece',
        playerId,
        pieceIds: ownIds,
        next: { kind: 'forAssaultSelectTarget', fromPieceId: '' as any, actingFaction },
        message: 'Select your unit to sacrifice (Assault)',
      } as any;
      break;
    }
    case 'recruitAtCapital': {
      // Find the capital piece for this player's faction
      const self = state.players.find((p) => p.id === playerId)!;
      const fac = self.faction;
      if (!fac) break;
      const cap = Object.values(state.pieces).find((pc) => pc.typeId === 'capital' && (pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined)) === fac);
      if (!cap || cap.location.kind !== 'node') break;
      const nodeId = cap.location.nodeId;
      // Disallow if capital is controlled by a faction other than self (enemy-controlled)
      const enemyControls = (() => {
        // Presence at node by other faction implies control
        for (const pc of Object.values(state.pieces)) {
          if (pc.location.kind !== 'node') continue;
          if (pc.location.nodeId !== nodeId) continue;
          const pf = pc.faction ?? (pc.ownerId ? state.players.find((p) => p.id === pc.ownerId)?.faction : undefined);
          if (pf && pf !== fac) return true;
        }
        // Else, exclusive adjacency by movement mode
        const landKinds = new Set(['road', 'path']);
        const waterKinds = new Set(['river', 'canal', 'coast', 'lake']);
        function neighborsByKinds(nid: string, kinds: Set<string>): string[] {
          const out: string[] = [];
          for (const e of Object.values(state.map.edges)) {
            if (!e.kinds || e.kinds.length === 0) continue;
            const has = e.kinds.some((k) => kinds.has(k));
            if (!has) continue;
            if (e.a === nid) out.push(e.b);
            else if (e.b === nid) out.push(e.a);
          }
          return out;
        }
        const contenders: Set<string> = new Set();
        // Consider factions present in players or pieces
        const factions = new Set<string>();
        for (const p of state.players) if (p.faction) factions.add(String(p.faction));
        for (const pc of Object.values(state.pieces)) if (pc.faction) factions.add(String(pc.faction));
        for (const f of Array.from(factions)) {
          let qualifies = false;
          for (const pc of Object.values(state.pieces)) {
            if (pc.location.kind !== 'node') continue;
            const pf = pc.faction ?? (pc.ownerId ? state.players.find((p) => p.id === pc.ownerId)?.faction : undefined);
            if (pf !== f) continue;
            const from = pc.location.nodeId;
            const isShip = pc.typeId === 'ship';
            const neigh = isShip ? neighborsByKinds(from, waterKinds) : neighborsByKinds(from, landKinds);
            if (neigh.includes(nodeId)) { qualifies = true; break; }
          }
          if (qualifies) {
            contenders.add(f);
            if (contenders.size > 1) break;
          }
        }
        // If exactly one contender and it's not self, enemy controls
        return contenders.size === 1 && !contenders.has(String(fac));
      })();
      if (enemyControls) {
        state.log.push({ message: `${self.name} cannot recruit at the capital while it is enemy-controlled.` });
        break;
      }
      const pieceId = genId('pc');
      state.pieces[pieceId] = {
        id: pieceId,
        faction: fac as any,
        typeId: (verb as any).pieceTypeId,
        location: { kind: 'node', nodeId },
      } as any;
      const label = (state.map.nodes as any)[nodeId]?.label ?? nodeId;
      const playerName = self.name ?? playerId;
      const ptName = (state.pieceTypes as any)[(verb as any).pieceTypeId]?.name ?? String((verb as any).pieceTypeId);
      state.log.push({ message: `${playerName} recruits ${String(fac).toUpperCase()} ${ptName.toLowerCase()} at ${label}` });
      break;
    }
    case 'moveCapital': {
      const self = state.players.find((p) => p.id === playerId)!;
      const fac = self.faction;
      if (!fac) break;
      const cap = Object.values(state.pieces).find((pc) => pc.typeId === 'capital' && (pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined)) === fac);
      if (!cap || cap.location.kind !== 'node') break;
      const from = cap.location.nodeId;
      // BFS up to N steps over any edges
      const maxSteps = Math.max(1, Number((verb as any).steps ?? 2));
      const visited = new Set<string>([from]);
      const queue: Array<{ nid: string; d: number }> = [{ nid: from, d: 0 }];
      const reachable = new Set<string>();
      while (queue.length) {
        const { nid, d } = queue.shift()!;
        if (d >= maxSteps) continue;
        const neigh = findAdjacentNodes(state.map, nid);
        for (const nb of neigh) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          const nd = d + 1;
          if (nd <= maxSteps) {
            reachable.add(nb);
            queue.push({ nid: nb, d: nd });
          }
        }
      }
      // Filter to safe nodes: no enemy or neutral pieces
      function isSafe(nid: string): boolean {
        for (const pc of Object.values(state.pieces)) {
          if (pc.location.kind !== 'node') continue;
          if (pc.location.nodeId !== nid) continue;
          const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
          if (pf && pf !== fac) return false;
        }
        return true;
      }
      const options = Array.from(reachable).filter(isSafe);
      if (options.length === 0) {
        state.log.push({ message: `No safe destination within ${maxSteps} of the capital.` });
        break;
      }
      state.prompt = {
        kind: 'selectNode',
        playerId,
        nodeOptions: options,
        next: { kind: 'forMoveCapital', fromNode: from } as any,
        message: `Choose a city (≤ ${maxSteps} steps) to move your capital to`,
      } as any;
      return;
    }
    case 'discardFromHand': {
      const self = state.players.find((p) => p.id === playerId)!;
      const hand = self.hand || [];
      let eligible = hand as any[];
      if ((verb as any).excludeStar) {
        eligible = eligible.filter((c) => !String(c?.name || '').includes('*'));
      }
      if (eligible.length === 0) {
        // Nothing to discard; no-op
        break;
      }
      if (eligible.length === 1) {
        const [card] = eligible;
        // remove from hand
        const idx = self.hand.indexOf(card);
        if (idx >= 0) self.hand.splice(idx, 1);
        state.discardPile = pushBottom(state.discardPile, [card]);
        state.log.push({ message: `${self.name} discards ${card.name || 'a card'}.` });
        break;
      }
      // Prompt to choose one to discard
      state.prompt = {
        kind: 'choose',
        playerId,
        choices: eligible.map((c) => ({
          kind: 'verb',
          verb: { type: 'discardCardById', cardId: c.id } as VerbSpec,
          label: `Discard ${c.name || c.id}`,
        })) as any,
        message: 'Choose a card to discard',
      } as any;
      return;
    }
    case 'discardCardById': {
      const self = state.players.find((p) => p.id === playerId)!;
      const idx = self.hand.findIndex((c: any) => c.id === (verb as any).cardId);
      if (idx >= 0) {
        const [card] = self.hand.splice(idx, 1);
        state.discardPile = pushBottom(state.discardPile, [card]);
        state.log.push({ message: `${self.name} discards ${card.name || 'a card'}.` });
      }
      break;
    }
    case 'shuffleInByBackText': {
      const label = String((verb as any).backText || '').trim();
      if (!label) break;
      // materialize all scenario cards with matching backText
      const dict = ((state as any).scenarioCardDict || (window as any)?.__scenarioCardDict) as Record<string, any> | undefined;
      const materialize = (window as any)?.__materializeCard as ((def: any)=>any) | undefined;
      const toAdd: any[] = [];
      if (dict && materialize) {
        for (const [cid, def] of Object.entries(dict)) {
          const back = String((def as any).backText || '');
          if (back === label) {
            try {
              toAdd.push(materialize({ id: cid, ...(def as any) }));
            } catch {}
          }
        }
      }
      if (toAdd.length > 0) {
        const merged = mergeDecks([state.drawPile, { cards: toAdd } as Deck]);
        state.drawPile = shuffleDeck(merged);
        state.log.push({ message: `Shuffled ${toAdd.length} ${label} card(s) into the draw pile.` });
      } else {
        state.log.push({ message: `No ${label} cards found to shuffle in.` });
      }
      break;
    }
    case 'addCardToHand': {
      const self = state.players.find((p) => p.id === playerId)!;
      const catalog = (state as any).cardCatalog as Record<string, any> | undefined;
      let src = catalog?.[verb.cardId];
      try {
        if (!src && (window as any).__cardCatalog) {
          src = (window as any).__cardCatalog[verb.cardId];
        }
        if (!src && ((state as any).scenarioCardDict || (window as any).__scenarioCardDict) && (window as any).__materializeCard) {
          const def = ((state as any).scenarioCardDict || (window as any).__scenarioCardDict)[verb.cardId];
          if (def) {
            src = (window as any).__materializeCard({ id: verb.cardId, ...(def as any) });
          }
        }
      } catch {}
      if (src) {
        // shallow clone is fine for Card
        const cardCopy = { ...(src as any) };
        self.hand.push(cardCopy);
        const nm = (cardCopy as any).name || (cardCopy as any).id || String(verb.cardId);
        state.log.push({ message: `${self.name} adds ${nm} to hand.` });
      } else {
        state.log.push({ message: `Card ${verb.cardId} not found in catalog.` });
      }
      break;
    }
    case 'addCardToPlayerHand': {
      const targetId = resolvePlayerSelector(state, playerId, (verb as any).player ?? 'self');
      const target = state.players.find((p) => p.id === targetId)!;
      const catalog = (state as any).cardCatalog as Record<string, any> | undefined;
      let src = catalog?.[verb.cardId];
      try {
        if (!src && (window as any).__cardCatalog) {
          src = (window as any).__cardCatalog[verb.cardId];
        }
        if (!src && ((state as any).scenarioCardDict || (window as any).__scenarioCardDict) && (window as any).__materializeCard) {
          const def = ((state as any).scenarioCardDict || (window as any).__scenarioCardDict)[verb.cardId];
          if (def) {
            src = (window as any).__materializeCard({ id: verb.cardId, ...(def as any) });
          }
        }
      } catch {}
      if (src) {
        const cardCopy = { ...(src as any) };
        target.hand.push(cardCopy);
        const nm = (cardCopy as any).name || (cardCopy as any).id || String(verb.cardId);
        state.log.push({ message: `${target.name} receives ${nm} to hand.` });
      } else {
        state.log.push({ message: `Card ${verb.cardId} not found in catalog.` });
      }
      break;
    }
    case 'addCardToDrawPile': {
      const catalog = (state as any).cardCatalog as Record<string, any> | undefined;
      let src = catalog?.[verb.cardId];
      try {
        if (!src && (window as any).__cardCatalog) src = (window as any).__cardCatalog[verb.cardId];
        if (!src && ((state as any).scenarioCardDict || (window as any).__scenarioCardDict) && (window as any).__materializeCard) {
          const def = ((state as any).scenarioCardDict || (window as any).__scenarioCardDict)[verb.cardId];
          if (def) src = (window as any).__materializeCard({ id: verb.cardId, ...(def as any) });
        }
      } catch {}
      if (src) {
        const cardCopy = { ...(src as any) };
        state.drawPile = mergeDecks([state.drawPile, { cards: [cardCopy] } as Deck]);
        if ((verb as any).shuffle !== false) state.drawPile = shuffleDeck(state.drawPile);
        const nm = (cardCopy as any).name || (cardCopy as any).id || String(verb.cardId);
        state.log.push({ message: `Shuffled ${nm} into the draw pile.` });
      } else {
        state.log.push({ message: `Card ${verb.cardId} not found in catalog.` });
      }
      break;
    }
    case 'discardCardFromPlayerById': {
      const targetId = resolvePlayerSelector(state, playerId, (verb as any).player ?? 'self');
      const target = state.players.find((p) => p.id === targetId)!;
      const idx = target.hand.findIndex((c: any) => c.id === (verb as any).cardId);
      if (idx >= 0) {
        const [card] = target.hand.splice(idx, 1);
        state.discardPile = pushBottom(state.discardPile, [card]);
        state.log.push({ message: `${target.name} discards ${card.name || (verb as any).cardId}.` });
      }
      break;
    }
    case 'tuckToPlayer': {
      const targetId = resolvePlayerSelector(state, playerId, (verb as any).player ?? 'self');
      const target = state.players.find((p) => p.id === targetId)!;
      const cardObj = (state as any).playingCard as any;
      if (cardObj) {
        target.tucked.push(cardObj);
        state.log.push({ message: `${target.name} tucks ${cardObj.name || cardObj.id}.` });
      }
      break;
    }
    case 'trashCardFromPlayerById': {
      const targetId = resolvePlayerSelector(state, playerId, (verb as any).player ?? 'self');
      const target = state.players.find((p) => p.id === targetId)!;
      const idx = target.hand.findIndex((c: any) => c.id === (verb as any).cardId);
      if (idx >= 0) {
        const [card] = target.hand.splice(idx, 1);
        // remove from game: do not add to discard
        state.log.push({ message: `${target.name} trashes ${card.name || (verb as any).cardId}.` });
      }
      break;
    }
    case 'trashCardById': {
      const cid = (verb as any).cardId as string;
      // From all players' hands
      for (const p of state.players) {
        let changed = false;
        p.hand = p.hand.filter((c: any) => {
          if (c.id === cid) { changed = true; return false; }
          return true;
        });
        if (changed) state.log.push({ message: `${p.name} trashes ${cid}.` });
        // From tucked
        if (Array.isArray(p.tucked)) {
          const keep: any[] = [];
          let any = false;
          for (const c of p.tucked) {
            if ((c as any).id === cid) { any = true; continue; }
            keep.push(c);
          }
          if (any) {
            (p as any).tucked = keep;
            state.log.push({ message: `Trashed tucked ${cid} from ${p.name}.` });
          }
        }
      }
      // From draw pile
      state.drawPile.cards = state.drawPile.cards.filter((c: any) => c.id !== cid);
      // From discard pile
      state.discardPile.cards = state.discardPile.cards.filter((c: any) => c.id !== cid);
      break;
    }
    case 'establishDaqi': {
      // Choose one Jin-controlled city excluding provided excludes; then place Da Qi base and neighbors
      const excludes: string[] = Array.isArray((verb as any).excludeNodes) ? (verb as any).excludeNodes : [];
      const allNodes = Object.keys(state.map.nodes);
      const jinControlled = allNodes.filter(nid => __nodeControlledByFaction(state, nid, 'jin'));
      const options = jinControlled.filter(nid => !excludes.includes(nid));
      if (options.length === 0) { state.log.push({ message: `No eligible Jin-controlled city to found Da Qi.` }); break; }
      state.prompt = {
        kind: 'selectNode',
        playerId,
        nodeOptions: options,
        next: { kind: 'forEstablishDaqi' } as any,
        message: 'Choose a Jin-controlled city (not Shangjing/Yanjing) to place Da Qi capital',
      } as any;
      return;
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
      // Single-step move; if a card needs multiple, include multiple move verbs
      const steps = 1;
      // Optional override: act as a specific faction (e.g., rebels)
      const actingFaction = resolveFactionSelector(state, playerId, (verb as any).actingFaction);
      // Prompt to select a piece owned by the acting side:
      // - If no actingFaction: player's own units + character option
      // - If actingFaction provided: any units of that faction
      let movablePieceIds: string[] = [];
      if (actingFaction) {
        movablePieceIds = Object.values(state.pieces)
          .filter((pc) => pc.location.kind === 'node')
          .filter((pc) => {
            const pf = pc.faction ?? (pc.ownerId ? state.players.find((p) => p.id === pc.ownerId)?.faction : undefined);
            return pf === actingFaction;
          })
          .map((pc) => pc.id);
      } else {
        movablePieceIds = Object.values(state.pieces).filter((pc) => pc.ownerId === playerId && pc.location.kind === 'node').map((pc) => pc.id);
        const ch = getControlledCharacter(state, playerId);
        if (ch && ch.location.kind === 'node') {
          movablePieceIds.unshift(`char:${ch.id}`);
        }
      }
      state.prompt = {
        kind: 'selectPiece',
        playerId,
        pieceIds: movablePieceIds,
        next: { kind: 'forMove', steps, actingFaction: (actingFaction as any) },
        message: actingFaction ? `Select a ${actingFaction} unit to move` : 'Select a unit (or your character) to move',
      };
      break;
    }
    case 'generalMove': {
      // Character-led convoy move
      const ch = getControlledCharacter(state, playerId);
      if (!ch || ch.location.kind !== 'node') { state.log.push({ message: `No character available to move.` }); break; }
      const from = ch.location.nodeId;
      // Movement modes
      function neighborsByMode(nodeId: string, mode: 'water' | 'land'): string[] {
        const nodes = new Set<string>();
        for (const e of Object.values(state.map.edges)) {
          const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
          const isWater = kinds.includes('river') || kinds.includes('canal') || kinds.includes('coast') || kinds.includes('lake') || kinds.includes('water') || kinds.includes('sea');
          if (mode === 'water' && !isWater) continue;
          if (mode === 'land' && isWater) continue;
          if (e.a === nodeId) nodes.add(e.b);
          else if (e.b === nodeId) nodes.add(e.a);
        }
        if (nodes.size === 0) return findAdjacentNodes(state.map, nodeId);
        return Array.from(nodes);
      }
      // Blocked if any non-friendly piece occupies
      const owner = state.players.find(p => p.id === playerId);
      const fac = owner?.faction;
      function nodeBlocked(nid: string): boolean {
        for (const pc of Object.values(state.pieces)) {
          if (pc.location.kind !== 'node') continue;
          if (pc.location.nodeId !== nid) continue;
          const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
          if (pf && pf !== fac) return true;
        }
        return false;
      }
      const landOpts = neighborsByMode(from, 'land').filter(n => !nodeBlocked(n));
      // Water option requires at least one friendly ship at origin
      const haveShipAtOrigin = Object.values(state.pieces).some(pc => pc.location.kind === 'node' && pc.location.nodeId === from && (pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined)) === fac && pc.typeId === 'ship');
      const waterOpts = haveShipAtOrigin ? neighborsByMode(from, 'water').filter(n => !nodeBlocked(n)) : [];
      const opts = Array.from(new Set([...landOpts, ...waterOpts]));
      state.prompt = {
        kind: 'selectNode',
        playerId,
        nodeOptions: opts,
        next: { kind: 'forGeneralMove', characterId: ch.id, fromNode: from, steps: Math.max(1, Number((verb as any).steps ?? 1)) },
        message: 'Select destination for general move',
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
      if (!ch || ch.location.kind !== 'node') { state.log.push({ message: `No character to target from.` }); break; }
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
      if (!ch || ch.location.kind !== 'node') { state.log.push({ message: `No character to recruit at.` }); break; }
      const faction = resolveFactionSelector(state, playerId, (verb as any).faction);
      // Inline place piece (avoid undefined helper)
      const pieceId = genId('pc');
      const ownerFaction = state.players.find((p) => p.id === playerId)?.faction;
      state.pieces[pieceId] = {
        id: pieceId,
        ownerId: playerId,
        faction: (faction as any) ?? (ownerFaction as any),
        typeId: verb.pieceTypeId,
        location: { kind: 'node', nodeId: ch.location.nodeId },
      };
      break;
    }
    case 'removeAt': {
      const nodeId = String((verb as any).nodeId);
      const pieceTypeId = (verb as any).pieceTypeId ? String((verb as any).pieceTypeId) : undefined;
      const faction = resolveFactionSelector(state, playerId, (verb as any).faction);
      const matchId = Object.entries(state.pieces).find(([, pc]) =>
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
      if (!ch || ch.location.kind !== 'node') { state.log.push({ message: `No character to convert at.` }); break; }
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
      if (!ch || ch.location.kind !== 'node') { state.log.push({ message: `No character to destroy at.` }); break; }
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
      if (!ch || ch.location.kind !== 'node') { state.log.push({ message: `No character to retreat from.` }); break; }
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
  // Special case: selecting the player's character (general move) encoded as "char:<id>"
  if (state.prompt.next.kind === 'forMove' && String(pieceId).startsWith('char:')) {
    const chId = String(pieceId).slice(5);
    const ch = state.characters[chId];
    if (!ch || ch.location.kind !== 'node') return;
    const pid0 = state.prompt.playerId;
    const owner = state.players.find(p => p.id === pid0);
    const fac = owner?.faction;
    const from = ch.location.nodeId;
    function neighborsByMode(nodeId: string, mode: 'water' | 'land'): string[] {
      const nodes = new Set<string>();
      for (const e of Object.values(state.map.edges)) {
        const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
        const isWater = kinds.includes('river') || kinds.includes('canal') || kinds.includes('coast') || kinds.includes('lake') || kinds.includes('water') || kinds.includes('sea');
        if (mode === 'water' && !isWater) continue;
        if (mode === 'land' && isWater) continue;
        if (e.a === nodeId) nodes.add(e.b);
        else if (e.b === nodeId) nodes.add(e.a);
      }
      if (nodes.size === 0) return findAdjacentNodes(state.map, nodeId);
      return Array.from(nodes);
    }
    function nodeBlocked(nid: string): boolean {
      for (const pc of Object.values(state.pieces)) {
        if (pc.location.kind !== 'node') continue;
        if (pc.location.nodeId !== nid) continue;
        const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
        if (pf && pf !== fac) return true;
      }
      return false;
    }
    const landOpts = neighborsByMode(from, 'land').filter(n => !nodeBlocked(n));
    const haveShipAtOrigin = Object.values(state.pieces).some(pc => pc.location.kind === 'node' && pc.location.nodeId === from && (pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined)) === fac && pc.typeId === 'ship');
    const waterOpts = haveShipAtOrigin ? neighborsByMode(from, 'water').filter(n => !nodeBlocked(n)) : [];
    const opts = Array.from(new Set([...landOpts, ...waterOpts]));
    const curPid = state.prompt.playerId;
    state.prompt = {
      kind: 'selectNode',
      playerId: curPid,
      nodeOptions: opts,
      next: { kind: 'forGeneralMove', characterId: ch.id, fromNode: from, steps: 1 },
      message: 'Select destination for general move',
    };
    return;
  }
  const piece = state.pieces[pieceId];
  if (!piece) return;
  if (state.prompt.next.kind === 'forMove') {
    if (piece.location.kind !== 'node') return;
    const owner = state.players.find(p => p.id === state.prompt!.playerId);
    const fac = (state.prompt.next as any).actingFaction ?? owner?.faction;
    // Compute allowed adjacents by movement mode
    function neighborsByMode(nodeId: string, mode: 'water' | 'land'): string[] {
      const nodes = new Set<string>();
      for (const e of Object.values(state.map.edges)) {
        const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
        const isWater = kinds.includes('river') || kinds.includes('canal') || kinds.includes('coast') || kinds.includes('lake') || kinds.includes('water') || kinds.includes('sea');
        if (mode === 'water' && !isWater) continue;
        if (mode === 'land' && isWater) continue;
        if (e.a === nodeId) nodes.add(e.b);
        else if (e.b === nodeId) nodes.add(e.a);
      }
      if (nodes.size === 0) return findAdjacentNodes(state.map, nodeId);
      return Array.from(nodes);
    }
    function nodeBlocked(nid: string): boolean {
      for (const pc of Object.values(state.pieces)) {
        if (pc.location.kind !== 'node') continue;
        if (pc.location.nodeId !== nid) continue;
        const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
        if (pf && pf !== fac) return true;
      }
      return false;
    }
    const mode: 'water' | 'land' = piece.typeId === 'ship' ? 'water' : 'land';
    const adj = neighborsByMode(piece.location.nodeId, mode).filter(n => !nodeBlocked(n));
    const curPid3 = state.prompt.playerId;
    state.prompt = {
      kind: 'selectAdjacentNode',
      playerId: curPid3,
      pieceId,
      nodeOptions: adj,
      stepsRemaining: state.prompt.next.steps,
      controlFaction: fac as any,
      message: 'Select destination',
    };
  } else if (state.prompt.next.kind === 'forDestroy') {
    delete state.pieces[pieceId];
    state.log.push({ message: `Destroyed piece ${pieceId}` });
    state.prompt = null;
    resumePendingIfAny(state);
  } else if (state.prompt.next.kind === 'forAssaultSelectTarget') {
    // First click selected own piece to sacrifice; now prompt for adjacent enemy target by proper mode
    const fromId = pieceId;
    const from = state.pieces[fromId];
    if (!from || from.location.kind !== 'node') { state.prompt = null; resumePendingIfAny(state); return; }
    // const self = state.players.find(p => p.id === state.prompt!.playerId);
    function neighborsByKinds(nodeId: string, kinds: Set<string>): string[] {
      const nodes = new Set<string>();
      for (const e of Object.values(state.map.edges)) {
        const ek = (e.kinds || []).map(k => String(k).toLowerCase());
        const match = ek.some(k => kinds.has(k));
        if (!match) continue;
        if (e.a === nodeId) nodes.add(e.b);
        else if (e.b === nodeId) nodes.add(e.a);
      }
      return Array.from(nodes);
    }
    const waterKinds = new Set(['river','canal','coast','lake','water','sea']);
    const landKindsAssault = new Set(['road','path']); // assault allows road or path for foot/horse
    const here = from.location.nodeId;
    const adjNodes = from.typeId === 'ship' ? neighborsByKinds(here, waterKinds) : neighborsByKinds(here, landKindsAssault);
    const eligible = Object.values(state.pieces)
      .filter(pc => pc.location.kind === 'node' && adjNodes.includes(pc.location.nodeId))
      .filter(pc => {
        // enemy of player
        return isEnemyPiece(state, state.prompt!.playerId, pc);
      })
      .map(pc => pc.id);
    if (eligible.length === 0) { state.prompt = null; resumePendingIfAny(state); return; }
    const curPid2 = state.prompt.playerId;
    state.prompt = {
      kind: 'selectPiece',
      playerId: curPid2,
      pieceIds: eligible,
      next: { kind: 'forAssaultResolve', fromPieceId: fromId },
      message: 'Select adjacent enemy to destroy (Assault)',
    } as any;
    return;
  } else if (state.prompt.next.kind === 'forAssaultResolve') {
    // Remove target and the sacrificed own piece
    const fromId = (state.prompt.next as any).fromPieceId as string;
    delete state.pieces[pieceId];
    if (state.pieces[fromId]) delete state.pieces[fromId];
    state.log.push({ message: `Assault trades your unit for enemy ${pieceId}` });
    state.prompt = null;
    resumePendingIfAny(state);
  }
}

export function inputSelectAdjacentNode(state: GameState, nodeId: NodeId): void {
  if (!state.prompt || state.prompt.kind !== 'selectAdjacentNode') return;
  const { pieceId, stepsRemaining } = state.prompt;
  const piece = state.pieces[pieceId];
  if (!piece || piece.location.kind !== 'node') return;
  // Revalidate: destination cannot contain enemy or neutral pieces
    const pid2 = state.prompt.playerId;
    const owner = state.players.find(p => p.id === pid2);
    const fac = (state.prompt as any).controlFaction ?? owner?.faction;
  for (const pc of Object.values(state.pieces)) {
    if (pc.location.kind !== 'node') continue;
    if (pc.location.nodeId !== nodeId) continue;
    const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
    if (pf && pf !== fac) return;
  }
  piece.location = { kind: 'node', nodeId };
  const remaining = stepsRemaining - 1;
  if (remaining > 0) {
    // Continue with same piece and movement mode
    function neighborsByMode(nodeId: string, mode: 'water' | 'land'): string[] {
      const nodes = new Set<string>();
      for (const e of Object.values(state.map.edges)) {
        const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
        const isWater = kinds.includes('river') || kinds.includes('canal') || kinds.includes('coast') || kinds.includes('lake') || kinds.includes('water') || kinds.includes('sea');
        if (mode === 'water' && !isWater) continue;
        if (mode === 'land' && isWater) continue;
        if (e.a === nodeId) nodes.add(e.b);
        else if (e.b === nodeId) nodes.add(e.a);
      }
      if (nodes.size === 0) return findAdjacentNodes(state.map, nodeId);
      return Array.from(nodes);
    }
    function nodeBlocked(nid: string): boolean {
      for (const pc of Object.values(state.pieces)) {
        if (pc.location.kind !== 'node') continue;
        if (pc.location.nodeId !== nid) continue;
        const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
        if (pf && pf !== fac) return true;
      }
      return false;
    }
    const mode: 'water' | 'land' = piece.typeId === 'ship' ? 'water' : 'land';
    const options = neighborsByMode(nodeId, mode).filter(n => !nodeBlocked(n));
    const curPid4 = state.prompt.playerId;
    state.prompt = {
      kind: 'selectAdjacentNode',
      playerId: curPid4,
      pieceId,
      nodeOptions: options,
      stepsRemaining: remaining,
      message: 'Select next destination',
    };
  } else {
    // If in a retreat flow, continue with next queued retreat
    const ret = (state as any).__retreat as any;
    if (ret && Array.isArray(ret.queue) && ret.queue.length > 0) {
      const nextItem = ret.queue.shift();
      const pieceNext = state.pieces[nextItem.id];
      if (pieceNext && pieceNext.location.kind === 'node') {
        const nid = nextItem.nodeId ?? ret.nodeId;
        const mode: 'water' | 'land' = pieceNext.typeId === 'ship' ? 'water' : 'land';
        function neighborsByMode(nodeIdLocal: string, mode: 'water' | 'land'): string[] {
          const nodes = new Set<string>();
          for (const e of Object.values(state.map.edges)) {
            const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
            const isWater = kinds.includes('river') || kinds.includes('canal') || kinds.includes('coast') || kinds.includes('lake') || kinds.includes('water') || kinds.includes('sea');
            if (mode === 'water' && !isWater) continue;
            if (mode === 'land' && isWater) continue;
            if (e.a === nodeIdLocal) nodes.add(e.b);
            else if (e.b === nodeIdLocal) nodes.add(e.a);
          }
          if (nodes.size === 0) return findAdjacentNodes(state.map, nodeIdLocal);
          return Array.from(nodes);
        }
        function isSafeNode(n: string, _factionLocal: any): boolean {
          for (const pc of Object.values(state.pieces)) {
            if (pc.location.kind !== 'node') continue;
            if (pc.location.nodeId !== n) continue;
            const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
            if (pf && pf !== nextItem.faction) return false;
          }
          return true;
        }
        const opts = neighborsByMode(nid, mode).filter(n => isSafeNode(n, nextItem.faction));
        if (opts.length > 1) {
          state.prompt = {
            kind: 'selectAdjacentNode',
            playerId: state.prompt.playerId,
            pieceId: nextItem.id,
            nodeOptions: opts,
            stepsRemaining: 1,
            controlFaction: nextItem.faction as any,
            message: 'Choose retreat destination',
          } as any;
          return;
        } else if (opts.length === 1) {
          pieceNext.location = { kind: 'node', nodeId: opts[0] };
          // fall through to either next in queue or finish
          if (ret.queue.length > 0) {
            // Tail recurse to schedule next
            (state as any).__retreat = ret;
            state.prompt = null;
            resumePendingIfAny(state);
            return;
          }
        } else {
          delete state.pieces[pieceNext.id];
        }
      }
      if (!ret.queue.length) (state as any).__retreat = undefined;
      state.prompt = null;
      resumePendingIfAny(state);
    } else {
      state.prompt = null;
      resumePendingIfAny(state);
    }
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
  } else if ((next as any).kind === 'forGeneralMove') {
    const chId = (next as any).characterId as string;
    const from = String((next as any).fromNode);
    // const steps = Math.max(1, Number((next as any).steps ?? 1));
    const ch = state.characters[chId];
    if (!ch || ch.location.kind !== 'node' || ch.location.nodeId !== from) { state.prompt = null; resumePendingIfAny(state); return; }
    const pid = state.prompt.playerId;
    const owner = state.players.find(p => p.id === pid);
    const fac = owner?.faction;
    // Determine available modes based on edge type between from and nodeId
    function isWaterEdge(a: string, b: string): boolean {
      for (const e of Object.values(state.map.edges)) {
        if (!((e.a === a && e.b === b) || (e.a === b && e.b === a))) continue;
        const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
        const isWater = kinds.includes('river') || kinds.includes('canal') || kinds.includes('coast') || kinds.includes('lake') || kinds.includes('water') || kinds.includes('sea');
        if (isWater) return true;
      }
      return false;
    }
    function isLandEdge(a: string, b: string): boolean {
      for (const e of Object.values(state.map.edges)) {
        if (!((e.a === a && e.b === b) || (e.a === b && e.b === a))) continue;
        const kinds = (e.kinds || []).map(k => String(k).toLowerCase());
        const isWater = kinds.includes('river') || kinds.includes('canal') || kinds.includes('coast') || kinds.includes('lake') || kinds.includes('water') || kinds.includes('sea');
        if (!isWater) return true;
      }
      return false;
    }
    const allowWater = isWaterEdge(from, nodeId);
    const allowLand = isLandEdge(from, nodeId);
    // Block if destination has any non-friendly piece
    for (const pc of Object.values(state.pieces)) {
      if (pc.location.kind !== 'node') continue;
      if (pc.location.nodeId !== nodeId) continue;
      const pf = pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined);
      if (pf && pf !== fac) { state.prompt = null; resumePendingIfAny(state); return; }
    }
    // Build convoy selection prompt
    const atOrigin = Object.values(state.pieces).filter(pc => pc.location.kind === 'node' && pc.location.nodeId === from);
    const friendlyAtOrigin = atOrigin.filter(pc => (pc.faction ?? (pc.ownerId ? state.players.find(p => p.id === pc.ownerId)?.faction : undefined)) === fac);
    const shipIds = friendlyAtOrigin.filter(pc => pc.typeId === 'ship').map(pc => pc.id);
    const nonShipIds = friendlyAtOrigin.filter(pc => pc.typeId !== 'ship').map(pc => pc.id);
    // Defaults:
    // - If water-only: require ship; default select exactly one ship
    // - Else (land allowed): default select all non-ships
    let selected: string[] = [];
    let requireShipForWater = false;
    if (allowWater && !allowLand) {
      requireShipForWater = true;
      if (shipIds.length === 0) { state.prompt = null; resumePendingIfAny(state); return; }
      selected = [shipIds[0]];
    } else {
      selected = [...nonShipIds];
    }
    state.prompt = {
      kind: 'selectConvoy',
      playerId: state.prompt.playerId,
      originNodeId: from,
      destinationNodeId: nodeId,
      allowLand,
      allowWater,
      options: friendlyAtOrigin.map(pc => pc.id),
      selected,
      requireShipForWater,
      message: 'Choose units to convoy (click to toggle), then Confirm',
    } as any;
  } else if ((next as any).kind === 'forEstablishDaqi') {
    const nid = nodeId;
    function placePieceAt(pt: string, f: any, n: string) {
      const pieceId = genId('pc');
      state.pieces[pieceId] = { id: pieceId, ownerId: state.prompt!.playerId, faction: f, typeId: pt as any, location: { kind: 'node', nodeId: n } };
    }
    // Place Da Qi capital and 3 foot at nid
    placePieceAt('capital', 'daqi', nid);
    for (let i = 0; i < 3; i++) placePieceAt('foot', 'daqi', nid);
    // Adjacent nodes with no Song or Rebel pieces
    const adj = findAdjacentNodes(state.map, nid);
    const eligible = adj.filter(n => {
      for (const pc of Object.values(state.pieces)) {
        if (pc.location.kind !== 'node' || pc.location.nodeId !== n) continue;
        if (pc.faction === 'song' || pc.faction === 'rebel') return false;
      }
      return true;
    });
    let footLeft = 3, shipLeft = 2;
    for (const n of eligible) {
      if (footLeft > 0) { placePieceAt('foot', 'daqi', n); footLeft--; }
      if (shipLeft > 0) { placePieceAt('ship', 'daqi', n); shipLeft--; }
      if (footLeft <= 0 && shipLeft <= 0) break;
    }
    // Also shuffle all Da Qi cards into the draw pile
    try {
      const dict = ((state as any).scenarioCardDict || (window as any)?.__scenarioCardDict) as Record<string, any> | undefined;
      const materialize = (window as any)?.__materializeCard as ((def: any)=>any) | undefined;
      const toAdd: any[] = [];
      if (dict && materialize) {
        for (const [cid, def] of Object.entries(dict)) {
          const back = String((def as any).backText || '');
          if (back === 'Da Qi') {
            try { toAdd.push(materialize({ id: cid, ...(def as any) })); } catch {}
          }
        }
      }
      if (toAdd.length > 0) {
        state.drawPile = shuffleDeck(mergeDecks([state.drawPile, { cards: toAdd } as Deck]));
        state.log.push({ message: `Shuffled ${toAdd.length} Da Qi card(s) into the draw pile.` });
      }
    } catch {}
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
  const anySel = sel as any;
  if (anySel && anySel.playerId) return anySel.playerId;
  if (anySel && anySel.controllerOfCharacterId) {
    const chId = String(anySel.controllerOfCharacterId);
    const ch = state.characters[chId];
    if (ch && ch.playerId) return ch.playerId;
    // Fallback: if character is unassigned, default to current player
    return selfId;
  }
  return selfId;
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

// Toggle a unit in the convoy selection
export function inputToggleConvoyPiece(state: GameState, pieceId: PieceId): void {
  if (!state.prompt || (state.prompt as any).kind !== 'selectConvoy') return;
  const pr = state.prompt as any;
  if (!pr.options.includes(pieceId)) return;
  const idx = pr.selected.indexOf(pieceId);
  if (idx >= 0) pr.selected.splice(idx, 1);
  else pr.selected.push(pieceId);
}

// Confirm selected convoy and execute the general move
export function inputConfirmConvoy(state: GameState): void {
  if (!state.prompt || (state.prompt as any).kind !== 'selectConvoy') return;
  const pr = state.prompt as any;
  const { originNodeId: from, destinationNodeId: to } = pr;
  const ch = Object.values(state.characters).find(c => c.playerId === pr.playerId);
  if (!ch || ch.location.kind !== 'node' || ch.location.nodeId !== from) { state.prompt = null; resumePendingIfAny(state); return; }
    // const owner = state.players.find(p => p.id === pr.playerId);
    // const fac = owner?.faction;
  // Determine effective mode
  const selectedPieces = pr.selected.map((id: string) => state.pieces[id]).filter(Boolean);
  const anyShipSelected = selectedPieces.some((pc: any) => pc.typeId === 'ship');
  let water = false;
  if (!pr.allowLand && pr.allowWater) water = true;
  else if (pr.allowWater && anyShipSelected) water = true;
  else water = false;
  // Enforce water requires a ship
  if (water) {
    const hasShip = selectedPieces.some((pc: any) => pc.typeId === 'ship');
    if (!hasShip) return; // keep prompt open until valid
  } else {
    // Land route cannot include ships; drop any ships from selection
    pr.selected = pr.selected.filter((id: string) => state.pieces[id]?.typeId !== 'ship');
  }
  // Move character
  ch.location = { kind: 'node', nodeId: to } as any;
  // Move selected pieces
  for (const pid of pr.selected) {
    const pc = state.pieces[pid];
    if (!pc) continue;
    pc.location = { kind: 'node', nodeId: to };
  }
  state.prompt = null;
  resumePendingIfAny(state);
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


