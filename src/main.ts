import "./style.css";
import { initialState } from "./sample/sampleData";
import { renderApp } from "./ui/render";
import { endTurn, getTurnStartSnapshot } from "./core/engine";
import {
  inputSelectAdjacentNode,
  inputSelectNode,
  inputSelectPiece,
  playCard,
  startTurn,
} from "./core/engine";
import type {
  Card,
  GameState,
  Piece,
  PieceType,
  DiplomacyMatrix,
  FactionId,
  Character,
  Tuckable,
} from "./core/types";
import { FactionColor } from "./core/types";
import { map as boardMap } from "./map/board";

let state: GameState = initialState;

const root = document.querySelector<HTMLDivElement>("#app")!;

function rerender() {
  renderApp(root, state, {
    onPlayCard: (cardId: string) => {
      playCard(state, cardId);
      rerender();
    },
    onSelectPiece: (pieceId: string) => {
      inputSelectPiece(state, pieceId);
      rerender();
    },
    onSelectNode: (nodeId: string) => {
      // route to the appropriate handler
      if (state.prompt?.kind === "selectAdjacentNode") {
        inputSelectAdjacentNode(state, nodeId);
      } else if (state.prompt?.kind === "selectNode") {
        inputSelectNode(state, nodeId);
      }
      rerender();
    },
    onEndTurn: () => {
      endTurn(state);
      rerender();
    },
    onUndo: () => {
      const snap = getTurnStartSnapshot();
      if (snap) {
        // Replace state object contents
        Object.assign(state, snap);
        // Ensure per-turn flags and prompt are reset so hand re-enables
        (state as any).hasPlayedThisTurn = false;
        (state as any).hasActedThisTurn = false;
        state.prompt = null;
        rerender();
      }
    },
  });
}

// Provide a global hook for SVG piece selection
(window as any).onSelectPiece = (pieceId: string) => {
  inputSelectPiece(state, pieceId);
  rerender();
};
(window as any).onEndTurn = () => {
  startTurn(state);
  rerender();
};
(window as any).onUndo = () => {
  const snap = getTurnStartSnapshot();
  if (snap) {
    Object.assign(state, snap);
    (state as any).hasPlayedThisTurn = false;
    (state as any).hasActedThisTurn = false;
    state.prompt = null;
    rerender();
  }
};

async function loadScenarioOrFallback() {
  try {
    const res = await fetch("/scenarios/first-jin-song.json", {
      cache: "no-cache",
    });
    if (!res.ok) throw new Error("fetch failed");
    const scenario: any = await res.json();
    state = buildStateFromScenario(scenario);
  } catch {
    state = initialState;
  }
  startTurn(state);
  rerender();
}

function getFactionHan(f: FactionId): string {
  if (f === "song") return "宋";
  if (f === "jin") return "金";
  if (f === "daqi") return "齊";
  return "？";
}

// Tarot-sized character cards and layout constants
const TAROT_CARD_WIDTH = 330;
const TAROT_CARD_HEIGHT = 570;
const SAFE_MARGIN_X = 30;
const SAFE_MARGIN_TOP = 20;
const ICON_BAND_X = SAFE_MARGIN_X;
const ICON_BAND_W = TAROT_CARD_WIDTH - SAFE_MARGIN_X * 2;
const ICON_BAND_H = 90;
const ICON_BAND_Y = TAROT_CARD_HEIGHT - (ICON_BAND_H + SAFE_MARGIN_TOP + 10);

function wrapTextToLines(
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
  maxLines = 8
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const avgChar = fontSizePx * 0.4; // more generous: assume narrower chars to fill width
  const spaceWidth = avgChar;
  function widthOf(s: string): number {
    if (!s) return 0;
    // approximate width: chars * avgChar, counting spaces
    return (
      s.length * avgChar + (s.split(" ").length - 1) * (spaceWidth - avgChar)
    );
  }
  for (const w of words) {
    const candidate = current ? current + " " + w : w;
    if (widthOf(candidate) <= maxWidthPx) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) {
        break;
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // Ellipsize if overflow
  const overflow = words.join(" ") !== lines.join(" ");
  if (overflow && lines.length) {
    let last = lines[lines.length - 1];
    while (widthOf(last + "…") > maxWidthPx && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = last + "…";
  }
  return lines;
}

function makeCharacterCardDataUrl(
  name: string,
  title: string,
  factions: FactionId[],
  quote?: { text: string; cite?: string }
): string {
  const width = TAROT_CARD_WIDTH;
  const height = TAROT_CARD_HEIGHT;
  const bandX = ICON_BAND_X,
    bandY = ICON_BAND_Y,
    bandW = ICON_BAND_W,
    bandH = ICON_BAND_H;
  const r = 16;
  const gap = 12;
  const iconsCount = 1 + Math.max(0, factions.length); // include character initials + faction icons
  const totalW = iconsCount * (r * 2) + (iconsCount - 1) * gap;
  const startX = bandX + (bandW - totalW) / 2 + r;
  const cy = bandY + bandH / 2;
  let iconsMarkup = "";
  // Character initials icon (leftmost)
  const initials = name
    .split(/\s+/)
    .map((s) => s[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  iconsMarkup += `<circle cx="${startX}" cy="${cy}" r="${r}" fill="#fff" stroke="#222" stroke-width="2"/>
      <text x="${startX}" y="${
    cy + 5
  }" text-anchor="middle" font-size="16" font-weight="700" fill="#111">${initials}</text>`;
  // Faction icons to the right
  factions.forEach((f, i) => {
    const cx = startX + (i + 1) * (2 * r + gap);
    const fill = (FactionColor as any)[f] || "#666";
    const char = getFactionHan(f);
    const textFill = f === "jin" ? "#111" : "#fff";
    iconsMarkup += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#222" stroke-width="2"/>
      <text x="${cx}" y="${
      cy + 5
    }" text-anchor="middle" font-size="16" font-weight="700" fill="${textFill}">${char}</text>`;
  });
  // Quote block above icon band (baked into SVG)
  let quoteMarkup = "";
  if (quote && quote.text) {
    const rawQ = quote.text;
    const lines = wrapTextToLines(rawQ, bandW, 13, 8).map((s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    );
    const c = quote.cite
      ? quote.cite
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
      : "";
    const baseY = Math.max(90, bandY - 30 - (lines.length - 1) * 14);
    const tspans = lines
      .map(
        (ln, i) => `<tspan x="${bandX}" dy="${i === 0 ? 0 : 14}">${ln}</tspan>`
      )
      .join("");
    const naturalCiteY = baseY + lines.length * 14 + 12;
    const minClearance = 10;
    const maxCiteY = bandY - minClearance;
    const citeY = Math.min(maxCiteY, naturalCiteY);
    quoteMarkup = `
  <text x="${bandX}" y="${baseY}" text-anchor="start" font-size="13" fill="#333" font-style="italic">${tspans}</text>
  ${
    c
      ? `<text x="${bandX}" y="${citeY}" text-anchor="start" font-size="11" fill="#444">— ${c}</text>`
      : ""
  }
`;
  }

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
  ${quoteMarkup}
  <rect x="${bandX}" y="${bandY}" width="${bandW}" height="${bandH}" fill="#eee" rx="8" ry="8"/>
  ${iconsMarkup}
</svg>`;
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return `data:image/svg+xml;charset=UTF-8,${encoded}`;
}

function materializeCardFromDef(def: any): Card {
  const id = String(def.id);
  const name = String(def.name ?? id);
  const verbs = Array.isArray(def.verbs) ? (def.verbs as any) : [];
  const c: Card = { id, name, verbs };
  if (def.icons) c.icons = def.icons;
  if (def.keepOnPlay !== undefined) c.keepOnPlay = !!def.keepOnPlay;
  if (
    def.quote &&
    typeof def.quote === "object" &&
    typeof def.quote.text === "string"
  ) {
    c.quote = {
      text: String(def.quote.text),
      cite: def.quote.cite ? String(def.quote.cite) : undefined,
    };
  }
  // Build asset if template requests it, else use provided asset
  if (def.asset && typeof def.asset === "object") {
    c.asset = def.asset;
  } else if (def.template === "character") {
    const title = String(def.title ?? "");
    const factions = Array.isArray(def.factions)
      ? (def.factions as FactionId[])
      : [];
    const path = makeCharacterCardDataUrl(name, title, factions, c.quote);
    c.asset = {
      path,
      size: { width: TAROT_CARD_WIDTH, height: TAROT_CARD_HEIGHT },
      iconSlot: {
        x: ICON_BAND_X,
        y: ICON_BAND_Y,
        width: ICON_BAND_W,
        height: ICON_BAND_H,
      },
    };
  }
  return c;
}

function asCards(
  arr: any[] | undefined,
  cardDict?: Record<string, any>
): Card[] {
  if (!arr) return [];
  return arr.map((v: any) => {
    if (typeof v === "string") {
      const def = cardDict ? cardDict[v] : undefined;
      if (def && typeof def === "object")
        return materializeCardFromDef({ id: v, ...def });
      return { id: v, name: v, verbs: [] };
    }
    if (v && typeof v === "object" && typeof v.id === "string") {
      const def = cardDict ? cardDict[v.id] : undefined;
      const merged = { ...(def || {}), ...v, id: v.id };
      return materializeCardFromDef(merged);
    }
    return { id: String(v), name: String(v), verbs: [] };
  });
}

function buildStateFromScenario(scn: any): GameState {
  // Piece types shared across factions; fill/colors come from owner faction
  const pieceTypes: Record<string, PieceType> = {
    foot: { id: "foot", name: "Foot", shape: "cube", width: 1 },
    horse: { id: "horse", name: "Horse", shape: "horse", width: 1 },
    ship: { id: "ship", name: "Ship", shape: "ship", width: 3 },
    capital: { id: "capital", name: "Capital", shape: "capital", width: 3 },
  };

  const cardDict: Record<string, any> = scn.cards ?? {};
  let players = (scn.players ?? []).map((p: any) => ({
    id: p.id,
    name: p.name || p.faction,
    hand: asCards(p.startingHand ?? [], cardDict),
    tucked: asCards(p.tucked ?? [], cardDict),
    coins: p.coins ?? 0,
    faction: p.faction,
  }));

  // Build mapping of faction -> players (supports 0,1,2+ players per faction)
  const playersByFaction = new Map<string, string[]>();
  players.forEach((p: any) => {
    if (!p.faction) return;
    const f = String(p.faction);
    const arr = playersByFaction.get(f) ?? [];
    arr.push(p.id as string);
    playersByFaction.set(f, arr);
  });

  // Ensure every faction referenced in pieces has a player owner; auto-add NPC players if missing
  const factionsInPieces = new Set<string>();
  for (const spec of scn.pieces ?? []) {
    if (spec && spec.faction) factionsInPieces.add(String(spec.faction));
  }
  for (const f of factionsInPieces) {
    if (f === "rebel") continue; // rebels are not players
    if (!playersByFaction.has(f)) {
      const id = `NPC-${f}`;
      players = players.concat([
        { id, name: f, hand: [], tucked: [], coins: 0, faction: f },
      ]);
      playersByFaction.set(f, [id]);
    }
  }

  const pieces: Record<string, Piece> = {};
  let counter = 0;
  const validNodes = new Set(Object.keys(boardMap.nodes));
  for (const spec of scn.pieces ?? []) {
    const typeId = String(spec.type);
    const nodeId = String(spec.nodeId);
    const faction = String(spec.faction);
    // Pieces are faction-owned; player ownership is optional (reserved for future standees)
    if (!validNodes.has(nodeId)) {
      console.warn(`[scenario] Skipping piece at unknown nodeId: ${nodeId}`);
      continue;
    }
    const count = Number(spec.count ?? 1);
    for (let i = 0; i < count; i++) {
      // Represent capitals as logical pieces so overlays can detect them; renderer will skip drawing them as normal pieces
      const id = `pz${++counter}`;
      pieces[id] = {
        id,
        faction: faction as any,
        typeId,
        location: { kind: "node", nodeId },
      };
    }
  }

  // Characters (player standees)
  const characters: Record<string, Character> = {};
  const characterSpecsById = new Map<string, any>();
  let cCounter = 0;
  for (const ch of scn.characters ?? []) {
    const id = ch.id ?? `ch${++cCounter}`;
    characterSpecsById.set(id, ch);
    const playerId = String(ch.playerId ?? "");
    const name = String((ch.name ?? playerId) || id);
    const faction =
      ch.faction !== undefined && ch.faction !== null
        ? (String(ch.faction) as FactionId)
        : undefined;
    const nodeId = String(ch.nodeId ?? "");
    if (!validNodes.has(nodeId)) {
      console.warn(
        `[scenario] Skipping character at unknown nodeId: ${nodeId}`
      );
      continue;
    }
    characters[id] = {
      id,
      name,
      playerId: playerId || id,
      faction,
      location: { kind: "node", nodeId },
      portrait: ch.portrait ?? undefined,
    };
  }

  // No special tuckable generation; cards must be defined in scenario (cards dict)
  const tuckables: Record<string, Tuckable> = {};

  // No auto-insertion or merging of tucked cards; use scenario definitions as-is

  const drawPile = { cards: asCards(scn.global?.drawPile ?? [], cardDict) };
  const discardPile = {
    cards: asCards(scn.global?.discardPile ?? [], cardDict),
  };

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
    diplomacy: buildNeutralDiplomacy(
      players
        .map((p: any) => p.faction as FactionId)
        .filter(Boolean) as FactionId[]
    ),
  };
  return state;
}

function buildNeutralDiplomacy(factions: FactionId[]): DiplomacyMatrix {
  const mat: Partial<DiplomacyMatrix> = {};
  for (const a of factions) {
    (mat as any)[a] = {};
    for (const b of factions) {
      (mat as any)[a][b] = "neutral";
    }
  }
  return mat as DiplomacyMatrix;
}

loadScenarioOrFallback();
