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

function describeCardRules(card: { verbs?: any[]; effect?: any }): string {
  if (!card) return "";
  if (card.effect) return describeEffect(card.effect).join("\n");
  if (Array.isArray(card.verbs)) return card.verbs.map(describeVerb).join("\n");
  return "";
}

function describeEffect(effect: any): string[] {
  if (!effect) return [];
  if (effect.kind === "all" && Array.isArray(effect.effects)) {
    return effect.effects.flatMap((e: any) => describeEffect(e));
  }
  if (effect.kind === "any" && Array.isArray(effect.effects)) {
    const opts = effect.effects.flatMap((e: any) => describeEffect(e));
    return ["Choose one:", ...opts.map((t: string) => `${t}`)];
  }
  if (effect.kind === "verb") return [describeVerb(effect.verb)];
  if (effect.kind === "if") {
    const cond = `If has ${effect?.condition?.icon ?? "icon"} tucked`;
    const thenLines = describeEffect(effect.then);
    const elseLines = effect.else ? describeEffect(effect.else) : [];
    return [
      `${cond}:`,
      ...thenLines.map((t: string) => `${t}`),
      ...(elseLines.length
        ? ["Else:", ...elseLines.map((t: string) => `${t}`)]
        : []),
    ];
  }
  return [];
}

function describeVerb(verb: any): string {
  if (!verb || typeof verb !== "object") return "";
  switch (verb.type) {
    case "draw":
      return `Draw ${verb.count}`;
    case "drawUpTo":
      return `Draw up to ${verb.limit} in hand`;
    case "tuck":
      return verb.target === "opponent"
        ? `Tuck this in front of the opponent`
        : `Tuck this in front of you`;
    case "gainCoin":
      return `Gain ${verb.amount} coin(s)`;
    case "destroy":
      return `Destroy any piece`;
    case "move":
      return `Move a piece ${verb.steps ?? 1} step(s)`;
    case "recruit": {
      const kind = String(
        verb.pieceTypeId || (verb.pieceTypes?.anyOf?.[0] ?? "piece")
      );
      const count = Math.max(1, Number(verb.count ?? 1));
      const pool =
        verb.at &&
        (verb.at as any).nodes &&
        Array.isArray((verb.at as any).nodes)
          ? (verb.at as any).nodes
          : undefined;
      const excl =
        Array.isArray(verb.excludeNodes) && verb.excludeNodes.length
          ? ` except ${verb.excludeNodes.join(", ")}`
          : "";
      if (pool && count > 1)
        return `Choose ${count} places to recruit 1 ${kind} each from [${pool.join(
          ", "
        )}]${excl}`;
      if (pool)
        return `Recruit 1 ${kind} in one of [${pool.join(", ")}]${excl}`;
      return count > 1 ? `Recruit ${count} ${kind}` : `Recruit 1 ${kind}`;
    }
    case "placeCharacter":
      return `Place your character in a nearby city`;
    case "endGame":
      return `End the game`;
    default:
      return "";
  }
}

function makeCharacterCardDataUrl(
  name: string,
  title: string,
  factions: FactionId[],
  quote?: { text: string; cite?: string },
  rulesText?: string
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
  // Rules text block (baked into SVG) — place higher up under title
  let rulesMarkup = "";
  let rulesBottomY = 0;
  if (rulesText && rulesText.trim()) {
    // Inline icon rendering using vectors matching board pieces
    let effectiveRules = rulesText;
    const primaryFaction = factions[0];
    // Auto-qualify ambiguous tokens for primary faction
    const qualify = (s: string, what: string) =>
      primaryFaction ? s.replace(new RegExp(`:${what}:`, 'g'), `:${primaryFaction}-${what}:`) : s;
    effectiveRules = qualify(effectiveRules, 'foot');
    effectiveRules = qualify(effectiveRules, 'horse');
    effectiveRules = qualify(effectiveRules, 'ship');

    // Measurement helpers
    const fontSize = 13;
    const FONT_FAMILY = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    // Precise text measurement using an offscreen SVG measurer
    const __msvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    __msvg.setAttribute('width', '0');
    __msvg.setAttribute('height', '0');
    (__msvg.style as any).position = 'fixed';
    (__msvg.style as any).left = '-9999px';
    const __mtext = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    __mtext.setAttribute('font-size', String(fontSize));
    __mtext.setAttribute('font-family', FONT_FAMILY);
    __msvg.appendChild(__mtext);
    document.body.appendChild(__msvg);
    __mtext.setAttribute('xml:space', 'preserve');
    const iconH = 12;
    function widthOfText(s: string): number {
      if (!s) return 0;
      // Treat pure spaces specially; some renderers return 0 width for measuring a space
      const spaceWidth = fontSize * 0.33;
      if (/^\s+$/.test(s)) return s.length * spaceWidth;
      try {
        __mtext.textContent = s;
        const w = (__mtext as any).getComputedTextLength?.() as number | undefined;
        if (typeof w === 'number' && isFinite(w)) return w;
      } catch {}
      // Fallback rough estimate if measurement fails
      const avgChar = fontSize * 0.58;
      const spaces = (s.match(/\s/g) || []).length;
      const non = s.length - spaces;
      return non * avgChar + spaces * spaceWidth;
    }
    function iconWidth(kind: string): number {
      if (kind === 'ship') return Math.round(iconH * 1.8);
      if (kind === 'capital') return Math.round(iconH * 1.2);
      if (kind === 'character') return iconH;
      return iconH; // foot, horse, dot, star
    }
    // Inline SVG icon generator for on-card rendering (fonts can't load inside data: SVG reliably)
    function iconMarkup(kind: string, faction?: FactionId): string {
      if (kind === 'dot') {
        return `<circle cx="6" cy="6" r="4" fill="#f0c419" stroke="#b78900" stroke-width="1"/>`;
      }
      if (kind === 'star') {
        const R = 5, r2 = 2.2; const cx = 6, cy = 6; const pts: Array<[number, number]> = [];
        for (let i = 0; i < 10; i++) { const ang = -Math.PI/2 + (i*Math.PI)/5; const rr = i%2===0?R:r2; pts.push([cx + rr*Math.cos(ang), cy + rr*Math.sin(ang)]); }
        const d = `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(p=>`L ${p[0]} ${p[1]}`).join(' ') + ' Z';
        return `<path d="${d}" fill="#000" stroke="#000" stroke-width="0.5"/>`;
      }
      if (kind === 'foot') {
        const fill = faction ? (FactionColor as any)[faction] ?? '#888' : '#fff';
        const stroke = faction ? '#000' : '#000';
        return `<rect x="0" y="0" width="12" height="12" rx="2" ry="2" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      }
      if (kind === 'horse') {
        const fill = faction ? (FactionColor as any)[faction] ?? '#888' : '#fff';
        return `<polygon points="6,0 0,12 12,12" fill="${fill}" stroke="#000" stroke-width="2"/>`;
      }
      if (kind === 'ship') {
        const fill = faction ? (FactionColor as any)[faction] ?? '#888' : '#fff';
        const w = iconWidth('ship'); const h = 6; const y = (12 - h)/2; const x = (12 - w)/2;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" ry="2" fill="${fill}" stroke="#000" stroke-width="2"/>`;
      }
      if (kind === 'capital') {
        const fill = faction ? (FactionColor as any)[faction] ?? '#000' : '#000';
        return `<path d="M1 12 L1 7 L5 4 L6 7 L8 3 L10 7 L11 12 Z" fill="${fill}" stroke="#000" stroke-width="1"/>`;
      }
      if (kind === 'character') {
        const f = faction ? (FactionColor as any)[faction] ?? '#000' : '#000';
        return `<circle cx="6" cy="6" r="6" fill="#fff" stroke="${f}" stroke-width="2"/>`;
      }
      return '';
    }
    type Item = { kind: 'text'; text: string } | { kind: 'icon'; which: string; faction?: FactionId };
    const tokenRe = /:((rebel|black|song|red|jin|yellow|daqi|green)-)?(foot|horse|ship|capital|character|dot|star):/g;
    function parseParagraph(par: string): Item[] {
      const out: Item[] = [];
      let last = 0; let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(par)) !== null) {
        const start = m.index; const end = tokenRe.lastIndex;
        if (start > last) out.push({ kind: 'text', text: par.slice(last, start) });
        const facStr = (m[2] || '').toLowerCase();
        const which = m[3].toLowerCase();
        let faction: FactionId | undefined = undefined;
        if (facStr === 'rebel' || facStr === 'black') faction = 'rebel' as FactionId;
        if (facStr === 'song' || facStr === 'red') faction = 'song' as FactionId;
        if (facStr === 'jin' || facStr === 'yellow') faction = 'jin' as FactionId;
        if (facStr === 'daqi' || facStr === 'green') faction = 'daqi' as FactionId;
        if (!faction && (which === 'foot' || which === 'horse' || which === 'ship' || which === 'capital' || which === 'character')) faction = primaryFaction;
        out.push({ kind: 'icon', which, faction });
        last = end;
      }
      if (last < par.length) out.push({ kind: 'text', text: par.slice(last) });
      return out;
    }
    function wrapItems(items: Item[], maxW: number): Item[][] {
      const lines: Item[][] = [];
      let current: Item[] = []; let used = 0;
      const pushLine = () => { if (current.length) lines.push(current); current = []; used = 0; };
      for (const it of items) {
        if (it.kind === 'text') {
          // split by spaces but preserve spaces
          const parts = it.text.split(/(\s+)/);
          for (const p of parts) {
            if (!p) continue;
            const w = widthOfText(p);
            if (used + w > maxW && used > 0) pushLine();
            current.push({ kind: 'text', text: p });
            used += w;
          }
        } else {
          const w = iconWidth(it.which);
          if (used + w > maxW && used > 0) pushLine();
          current.push(it);
          used += w + 2; // small gap after icon
        }
      }
      if (current.length) lines.push(current);
      return lines.slice(0, 10); // cap lines
    }

    const startY = 110; const lineGap = 16; const groupGap = 8;
    let yCursor = startY;
    let parts: string[] = [];
    const paragraphs = effectiveRules.split(/\n+/).map(s => s.trim()).filter(Boolean);
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const items = parseParagraph(paragraphs[pIdx]);
      const lines = wrapItems(items, bandW);
      for (let li = 0; li < lines.length; li++) {
        let x = bandX;
        for (const it of lines[li]) {
          if (it.kind === 'text') {
            const w = widthOfText(it.text);
            if (/^\s+$/.test(it.text)) {
              // advance only; rely on positioning for visual spaces
              x += w;
            } else {
              const safe = it.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              parts.push(`<text x="${x}" y="${yCursor}" font-size="${fontSize}" font-family="${FONT_FAMILY}" fill="#222" xml:space="preserve">${safe}</text>`);
              x += w;
            }
          } else {
            const w = iconWidth(it.which);
            const tx = x; const ty = yCursor - 10; // baseline adjust
            parts.push(`<g transform="translate(${tx}, ${ty})">${iconMarkup(it.which, it.faction)}</g>`);
            x += w + 2;
          }
        }
        yCursor += lineGap;
      }
      // paragraph gap
      yCursor += groupGap;
    }
    rulesBottomY = yCursor - groupGap;
    rulesMarkup = parts.join('');
    // Clean up measurer
    try { __msvg.remove(); } catch {}
  }

  // Quote block above icon band — ensure no overlap with rules text
  let quoteMarkup = "";
  if (quote && quote.text) {
    const rawQ = quote.text;
    const qLines = wrapTextToLines(rawQ, bandW, 13, 8).map((s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    );
    const c = quote.cite
      ? quote.cite
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
      : "";
    const minY = rulesBottomY ? rulesBottomY + 10 : 90;
    const byBand = bandY - 30 - (qLines.length - 1) * 14;
    const baseY = Math.max(minY, byBand);
    const tspans = qLines
      .map(
        (ln, i) => `<tspan x="${bandX}" dy="${i === 0 ? 0 : 14}">${ln}</tspan>`
      )
      .join("");
    const naturalCiteY = baseY + qLines.length * 14 + 12;
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
    <style type="text/css"><![CDATA[
      @font-face {
        font-family: 'PieceIcons';
        src: url('/fonts/piece-icons.woff2') format('woff2'), url('/fonts/piece-icons.ttf') format('truetype');
      }
    ]]></style>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#cardGrad)" rx="12" ry="12"/>
  <text x="50%" y="42" text-anchor="middle" font-size="20" font-weight="700" fill="#111">${name}</text>
  <text x="50%" y="70" text-anchor="middle" font-size="16" fill="#333">${title}</text>
  ${quoteMarkup}
  ${rulesMarkup}
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
  if (typeof def.rulesTextOverride === "string")
    (c as any).rulesTextOverride = String(def.rulesTextOverride);
  if (def.keepOnPlay !== undefined) c.keepOnPlay = !!def.keepOnPlay;
  if (def.effect && typeof def.effect === "object") {
    // Trust scenario to provide a valid Effect tree
    (c as any).effect = def.effect;
  }
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
    const rulesText =
      (c as any).rulesTextOverride ||
      describeCardRules({ verbs: c.verbs, effect: (c as any).effect });
    const path = makeCharacterCardDataUrl(
      name,
      title,
      factions,
      c.quote,
      rulesText
    );
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

  // Move any initially tucked cards into hands; start with empty tucks
  players = players.map((p: any) => {
    const moved = { ...p, hand: [...p.hand, ...(p.tucked ?? [])], tucked: [] };
    return moved;
  });

  // Build mapping of faction -> players (supports 0,1,2+ players per faction)
  const playersByFaction = new Map<string, string[]>();
  players.forEach((p: any) => {
    if (!p.faction) return;
    const f = String(p.faction);
    const arr = playersByFaction.get(f) ?? [];
    arr.push(p.id as string);
    playersByFaction.set(f, arr);
  });

  // Do not auto-create players for factions present on pieces. Factions are independent of players.

  // Start with an empty board; initial setup will be enacted by setup cards
  const pieces: Record<string, Piece> = {};
  const validNodes = new Set(Object.keys(boardMap.nodes));

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

  const seatingOrder =
    scn.seating && Array.isArray(scn.seating.order)
      ? (scn.seating.order as string[])
      : players.map((p: any) => p.id as string);
  const firstSeat = seatingOrder[0] ?? players[0]?.id;

  // Build diplomacy across all factions present in players or pieces
  const playerFactions = Array.from(
    new Set(players.map((p: any) => p.faction).filter(Boolean))
  ) as string[];
  const pieceFactions = Array.from(
    new Set(
      Object.values(pieces)
        .map((pc: any) => pc.faction)
        .filter(Boolean)
    )
  ) as string[];
  const allFactions = Array.from(
    new Set([...playerFactions, ...pieceFactions])
  ) as FactionId[];

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
    currentPlayerId: firstSeat,
    viewPlayerId: firstSeat,
    seating: { order: seatingOrder },
    prompt: null,
    gameOver: false,
    log: [],
    diplomacy: buildNeutralDiplomacy(allFactions),
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
