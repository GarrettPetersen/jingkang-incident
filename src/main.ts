import './style.css'
import { initialState } from './sample/sampleData'
import { renderApp } from './ui/render'
import { endTurn, getTurnStartSnapshot } from './core/engine'
import { inputSelectAdjacentNode, inputSelectNode, inputSelectPiece, playCard, startTurn } from './core/engine'
import type { Card, GameState, Piece, PieceType, DiplomacyMatrix, FactionId, Character, Tuckable } from './core/types'
import { FactionColor } from './core/types'
import { map as boardMap } from './map/board'

let state: GameState = initialState

const root = document.querySelector<HTMLDivElement>('#app')!

function rerender() {
  renderApp(root, state, {
    onPlayCard: (cardId: string) => {
      playCard(state, cardId)
      rerender()
    },
    onSelectPiece: (pieceId: string) => {
      inputSelectPiece(state, pieceId)
      rerender()
    },
    onSelectNode: (nodeId: string) => {
      // route to the appropriate handler
      if (state.prompt?.kind === 'selectAdjacentNode') {
        inputSelectAdjacentNode(state, nodeId)
      } else if (state.prompt?.kind === 'selectNode') {
        inputSelectNode(state, nodeId)
      }
      rerender()
    },
    onEndTurn: () => {
      endTurn(state)
      rerender()
    },
    onUndo: () => {
      const snap = getTurnStartSnapshot()
      if (snap) {
        // Replace state object contents
        Object.assign(state, snap)
        // Ensure per-turn flags and prompt are reset so hand re-enables
        ;(state as any).hasPlayedThisTurn = false
        ;(state as any).hasActedThisTurn = false
        state.prompt = null
        rerender()
      }
    },
  })
}

// Provide a global hook for SVG piece selection
;(window as any).onSelectPiece = (pieceId: string) => {
  inputSelectPiece(state, pieceId)
  rerender()
}

;(window as any).onEndTurn = () => {
  startTurn(state)
  rerender()
}

;(window as any).onUndo = () => {
  const snap = getTurnStartSnapshot()
  if (snap) {
    Object.assign(state, snap)
    ;(state as any).hasPlayedThisTurn = false
    ;(state as any).hasActedThisTurn = false
    state.prompt = null
    rerender()
  }
}

async function loadScenarioOrFallback() {
  try {
    const res = await fetch('/scenarios/first-jin-song.json', { cache: 'no-cache' })
    if (!res.ok) throw new Error('fetch failed')
    const scenario: any = await res.json()
    state = buildStateFromScenario(scenario)
  } catch {
    state = initialState
  }
  startTurn(state)
rerender()
}

function getFactionHan(f: FactionId): string { if (f === 'song') return '宋'; if (f === 'jin') return '金'; if (f === 'daqi') return '齊'; return '？'; }

function makeCharacterCardDataUrl(name: string, title: string, factions: FactionId[]): string {
  const width = 300; const height = 420;
  const bandX = 24, bandY = 320, bandW = 252, bandH = 72;
  const r = 16; const gap = 12;
  const iconsCount = 1 + Math.max(0, factions.length); // include character initials + faction icons
  const totalW = iconsCount * (r * 2) + (iconsCount - 1) * gap;
  const startX = bandX + (bandW - totalW) / 2 + r;
  const cy = bandY + bandH / 2;
  let iconsMarkup = '';
  // Character initials icon (leftmost)
  const initials = name.split(/\s+/).map(s => s[0] || '').join('').slice(0,2).toUpperCase();
  iconsMarkup += `<circle cx="${startX}" cy="${cy}" r="${r}" fill="#fff" stroke="#222" stroke-width="2"/>
      <text x="${startX}" y="${cy + 5}" text-anchor="middle" font-size="16" font-weight="700" fill="#111">${initials}</text>`
  // Faction icons to the right
  factions.forEach((f, i) => {
    const cx = startX + (i + 1) * (2 * r + gap);
    const fill = (FactionColor as any)[f] || '#666';
    const char = getFactionHan(f);
    const textFill = (f === 'jin') ? '#111' : '#fff';
    iconsMarkup += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#222" stroke-width="2"/>
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="16" font-weight="700" fill="${textFill}">${char}</text>`;
  });
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f6f6f6"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#cardGrad)" rx="12" ry="12"/>
  <text x="50%" y="42" text-anchor="middle" font-size="20" font-weight="700" fill="#111">${name}</text>
  <text x="50%" y="70" text-anchor="middle" font-size="16" fill="#333">${title}</text>
  <rect x="${bandX}" y="${bandY}" width="${bandW}" height="${bandH}" fill="#eee" rx="8" ry="8"/>
  ${iconsMarkup}
</svg>`
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')
  return `data:image/svg+xml;charset=UTF-8,${encoded}`
}

function asCards(arr: any[] | undefined): Card[] {
  if (!arr) return []
  return arr.map((v: any) => {
    if (typeof v === 'string') return { id: v, name: v, verbs: [] }
    if (v && typeof v === 'object' && typeof v.id === 'string') return { id: v.id, name: v.name ?? v.id, verbs: (v.verbs ?? []) }
    return { id: String(v), name: String(v), verbs: [] }
  })
}

function buildStateFromScenario(scn: any): GameState {
  // Piece types shared across factions; fill/colors come from owner faction
  const pieceTypes: Record<string, PieceType> = {
    foot:   { id: 'foot',   name: 'Foot',   shape: 'cube',    width: 1 },
    horse:  { id: 'horse',  name: 'Horse',  shape: 'horse',   width: 1 },
    ship:   { id: 'ship',   name: 'Ship',   shape: 'ship',    width: 3 },
    capital:{ id: 'capital',name: 'Capital',shape: 'capital', width: 3 },
  }

  let players = (scn.players ?? []).map((p: any) => ({
    id: p.id,
    name: p.name || p.faction,
    hand: asCards(p.startingHand ?? []),
    tucked: asCards(p.tucked ?? []),
    coins: p.coins ?? 0,
    faction: p.faction,
  }))

  // Build mapping of faction -> players (supports 0,1,2+ players per faction)
  const playersByFaction = new Map<string, string[]>()
  players.forEach((p: any) => {
    if (!p.faction) return
    const f = String(p.faction)
    const arr = playersByFaction.get(f) ?? []
    arr.push(p.id as string)
    playersByFaction.set(f, arr)
  })

  // Ensure every faction referenced in pieces has a player owner; auto-add NPC players if missing
  const factionsInPieces = new Set<string>()
  for (const spec of (scn.pieces ?? [])) {
    if (spec && spec.faction) factionsInPieces.add(String(spec.faction))
  }
  for (const f of factionsInPieces) {
    if (f === 'rebel') continue; // rebels are not players
    if (!playersByFaction.has(f)) {
      const id = `NPC-${f}`
      players = players.concat([{ id, name: f, hand: [], tucked: [], coins: 0, faction: f }])
      playersByFaction.set(f, [id])
    }
  }

  const pieces: Record<string, Piece> = {}
  let counter = 0
  const validNodes = new Set(Object.keys(boardMap.nodes))
  for (const spec of (scn.pieces ?? [])) {
    const typeId = String(spec.type)
    const nodeId = String(spec.nodeId)
    const faction = String(spec.faction)
    // Pieces are faction-owned; player ownership is optional (reserved for future standees)
    if (!validNodes.has(nodeId)) {
      console.warn(`[scenario] Skipping piece at unknown nodeId: ${nodeId}`)
      continue
    }
    const count = Number(spec.count ?? 1)
    for (let i = 0; i < count; i++) {
      // Represent capitals as logical pieces so overlays can detect them; renderer will skip drawing them as normal pieces
      const id = `pz${++counter}`
      pieces[id] = { id, faction: faction as any, typeId, location: { kind: 'node', nodeId } }
    }
  }

  // Characters (player standees)
  const characters: Record<string, Character> = {}
  let cCounter = 0
  for (const ch of (scn.characters ?? [])) {
    const id = ch.id ?? `ch${++cCounter}`
    const playerId = String(ch.playerId ?? '')
    const name = String((ch.name ?? playerId) || id)
    const faction = (ch.faction !== undefined && ch.faction !== null) ? String(ch.faction) as FactionId : undefined
    const nodeId = String(ch.nodeId ?? '')
    if (!validNodes.has(nodeId)) {
      console.warn(`[scenario] Skipping character at unknown nodeId: ${nodeId}`)
      continue
    }
    characters[id] = {
      id,
      name,
      playerId: playerId || id,
      faction,
      location: { kind: 'node', nodeId },
      portrait: ch.portrait ?? undefined,
    }
  }

  // Build tuckable token catalog (one per character)
  const tuckables: Record<string, Tuckable> = {}
  for (const ch of Object.values(characters)) {
    const tokenId = `token-char-${ch.id}`
    // Title by character at 1127 context
    const lowerId = ch.id.toLowerCase()
    let title = ''
    if (lowerId.includes('yue-fei')) title = 'Loyal Song Officer'
    else if (lowerId.includes('liu-yu')) title = 'Song Official'
    else if (lowerId.includes('qin-hui')) title = 'Jin Captive'
    else if (lowerId.includes('talan')) title = 'Jin General'
    else if (lowerId.includes('wuzhu')) title = 'Jin General'
    // Faction affiliations for icon row
    const affils: FactionId[] = ((): FactionId[] => {
      if (ch.faction) return [ch.faction]
      if (lowerId.includes('yue-fei')) return ['song'] as FactionId[]
      if (lowerId.includes('liu-yu')) return ['song'] as FactionId[]
      if (lowerId.includes('qin-hui')) return ['jin'] as FactionId[]
      if (lowerId.includes('talan')) return ['jin'] as FactionId[]
      if (lowerId.includes('wuzhu')) return ['jin'] as FactionId[]
      return []
    })()
    const path = makeCharacterCardDataUrl(ch.name, title, affils)
    const asset = { path, size: { width: 300, height: 420 }, iconSlot: { x: 24, y: 320, width: 252, height: 72 } }
    tuckables[tokenId] = { id: tokenId, name: `${ch.name}, ${title || ''}`.trim(), kind: 'character', asset }
  }

  // Ensure each player starts with a tucked token for their character (if present)
  for (const pl of players) {
    const ch = Object.values(characters).find(c => c.playerId === pl.id)
    if (ch) {
      const tokenId = `token-char-${ch.id}`
      const t = tuckables[tokenId]
      const displayName = t?.name ?? ch.name
      const card: Card = {
        id: tokenId,
        name: displayName,
        verbs: [],
        icons: ((): FactionId[] | undefined => {
          const lowerId = ch.id.toLowerCase()
          if (ch.faction) return [ch.faction]
          if (lowerId.includes('yue-fei')) return ['song'] as FactionId[]
          if (lowerId.includes('liu-yu')) return ['song'] as FactionId[]
          if (lowerId.includes('qin-hui')) return ['jin'] as FactionId[]
          if (lowerId.includes('talan')) return ['jin'] as FactionId[]
          if (lowerId.includes('wuzhu')) return ['jin'] as FactionId[]
          return undefined
        })(),
        asset: t?.asset,
        keepOnPlay: true,
      }
      if (!pl.tucked.some((c: Card) => c.id === card.id)) {
        pl.tucked.push(card)
      }
    }
  }

  const drawPile = { cards: asCards(scn.global?.drawPile ?? []) }
  const discardPile = { cards: asCards(scn.global?.discardPile ?? []) }

  const state: GameState = {
    map: boardMap,
    pieceTypes,
    pieces,
    characters,
    tuckables,
    players,
    drawPile,
    discardPile,
    currentPlayerIndex: 0,
    currentPlayerId: players[0]?.id,
    viewPlayerId: players[0]?.id,
    seating: { order: players.map((p: any) => p.id as string) },
    prompt: null,
    gameOver: false,
    log: [],
    diplomacy: buildNeutralDiplomacy(players.map((p: any) => p.faction as FactionId).filter(Boolean) as FactionId[]),
  }
  return state
}

function buildNeutralDiplomacy(factions: FactionId[]): DiplomacyMatrix {
  const mat: Partial<DiplomacyMatrix> = {}
  for (const a of factions) {
    (mat as any)[a] = {}
    for (const b of factions) {
      (mat as any)[a][b] = 'neutral'
    }
  }
  return mat as DiplomacyMatrix
}

loadScenarioOrFallback()
