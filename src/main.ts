import './style.css'
import { initialState } from './sample/sampleData'
import { renderApp } from './ui/render'
import { endTurn, getTurnStartSnapshot } from './core/engine'
import { inputSelectAdjacentNode, inputSelectNode, inputSelectPiece, playCard, startTurn } from './core/engine'
import type { Card, GameState, Piece, PieceType, DiplomacyMatrix, FactionId } from './core/types'
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

  const drawPile = { cards: asCards(scn.global?.drawPile ?? []) }
  const discardPile = { cards: asCards(scn.global?.discardPile ?? []) }

  const state: GameState = {
    map: boardMap,
    pieceTypes,
    pieces,
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
