import "./style.css";
import { initialState } from "./sample/sampleData";
import { renderApp } from "./ui/render";
import { endTurn, getTurnStartSnapshot, inputChoose } from "./core/engine";
import {
  inputSelectAdjacentNode,
  inputSelectNode,
  inputSelectPiece,
  inputToggleConvoyPiece,
  inputConfirmConvoy,
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
function resolveReferences(text: string): string {
  try {
    const cat = (window as any).__cardCatalog as Record<string, any> | undefined;
    const dict = (window as any).__scenarioCardDict as Record<string, any> | undefined;
    const getName = (id: string) =>
      (cat && cat[id] && cat[id].name) || (dict && dict[id] && String(dict[id].name || dict[id].title || id)) || id;
    return String(text || '').replace(/\[\[([\w:-]+)\]\]/g, (_m, id) => getName(String(id)));
  } catch {
    return String(text || '').replace(/\[\[([\w:-]+)\]\]/g, (_m, id) => String(id));
  }
}

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
(window as any).onChoose = (index: number) => {
  inputChoose(state, index);
  rerender();
};
(window as any).onToggleConvoy = (pieceId: string) => {
  inputToggleConvoyPiece(state, pieceId);
  rerender();
};
(window as any).onConfirmConvoy = () => {
  inputConfirmConvoy(state);
  rerender();
};

async function loadScenarioOrFallback() {
  try {
    const res = await fetch("/scenarios/first-jin-song.json", {
      cache: "no-cache",
    });
    if (!res.ok) throw new Error("fetch failed");
    const scenario: any = await res.json();
    try { (window as any).__scenarioCardDict = scenario.cards || {}; } catch {}
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
  if ((effect as any).label) return [String((effect as any).label)];
  if (effect.kind === "all" && Array.isArray(effect.effects)) {
    return effect.effects.flatMap((e: any) => describeEffect(e));
  }
  if (effect.kind === "any" && Array.isArray(effect.effects)) {
    const opts = effect.effects.flatMap((e: any) => describeEffect(e));
    return ["Choose one:", ...opts.map((t: string) => `${t}`)];
  }
  if (effect.kind === "verb") return [describeVerb(effect.verb)];
  if (effect.kind === "if") {
    function describeCondition(cond: any): string {
      if (!cond || typeof cond !== "object") return "If condition";
      switch (cond.kind) {
        case "hasTuckedIcon": {
          const who =
            cond.who === "others"
              ? "an opponent has"
              : "you have";
          const need = Math.max(1, Number(cond.atLeast ?? 1));
          const icon = String(cond.icon ?? "icon");
          return need > 1
            ? `If ${who} at least ${need} ${icon} tucked`
            : `If ${who} ${icon} tucked`;
        }
        case "noStarCardInHand":
          return "If you have no '*' card in hand";
        case "hasCoins":
          return `If you have at least ${Math.max(0, Number(cond.atLeast ?? 0))} coins`;
        case "handCountAtLeast":
          return `If your hand has at least ${Math.max(0, Number(cond.atLeast ?? 0))} cards`;
        case "characterAt": {
          const nodes = Array.isArray(cond.nodes) ? cond.nodes.join(", ") : "specified cities";
          return `If your character is at ${nodes}`;
        }
        case "characterAtCityWithPiece": {
          const pt = String(cond.pieceTypeId ?? "piece");
          const fac = cond.faction ? String(cond.faction) : "";
          const label = fac ? `${fac} ${pt}` : pt;
          return `If your character is at a city with ${label}`;
        }
        case "nodeHasFaction": {
          const node = String(cond.nodeId ?? "a city");
          const fac = String(cond.faction ?? "a faction");
          return `If ${node} has ${fac} presence`;
        }
        case "nodeControlledBy": {
          const node = String(cond.nodeId ?? "a city");
          const fac = String(cond.faction ?? "a faction");
          return `If ${node} is controlled by ${fac}`;
        }
        default:
          return "If condition";
      }
    }
    const cond = describeCondition(effect?.condition);
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
    case "generalMove": {
      const steps = Math.max(1, Number(verb.steps ?? 1));
      return `General move your character up to ${steps} step(s) (with convoy)`;
    }
    case "recruitAtCapital": {
      const kind = String(verb.pieceTypeId ?? "unit");
      const fac = verb.faction ? String(verb.faction) : "";
      const facLabel = fac ? ` (${fac})` : "";
      return `Recruit ${kind}${facLabel} at your capital`;
    }
    case "moveCapital": {
      const steps = Math.max(1, Number(verb.steps ?? 2));
      return `Move your capital up to ${steps} step(s)`;
    }
    case "discardFromHand":
      return verb.excludeStar
        ? "Discard a non-'*' card from your hand"
        : "Discard a card from your hand";
    case "discardCardById":
      return `Discard the specified card`;
    case "addCardToHand":
      return `Add ${String(verb.cardId)} to your hand`;
    case "retrieveFromDiscard": {
      const match = String(verb.match ?? "card");
      const tgt =
        verb.target === "opponent"
          ? "an opponent"
          : (verb.target && (verb.target as any).playerId)
          ? "a player"
          : "you";
      return `Retrieve a card matching "${match}" from discard and tuck it in front of ${tgt}`;
    }
    case "destroyNearby": {
      const kinds = (verb.pieceTypes && verb.pieceTypes.anyOf) || [];
      const label =
        Array.isArray(kinds) && kinds.length
          ? kinds.join(", ")
          : "enemy";
      return `Destroy an adjacent enemy ${label}`;
    }
    case "recruitAtCharacter": {
      const kind = String(verb.pieceTypeId ?? "unit");
      const fac = verb.faction ? String(verb.faction) : "";
      const facLabel = fac ? ` (${fac})` : "";
      return `Recruit ${kind}${facLabel} at your character`;
    }
    case "removeAt": {
      const node = String(verb.nodeId ?? "a city");
      const pt = verb.pieceTypeId ? String(verb.pieceTypeId) : "a piece";
      const fac = verb.faction ? ` (${String(verb.faction)})` : "";
      return `Remove ${pt}${fac} at ${node}`;
    }
    case "convertAtCharacter": {
      const from = verb.fromFaction ? String(verb.fromFaction) : "any faction";
      const to = String(verb.toFaction ?? "target faction");
      const kinds = (verb.pieceTypes && verb.pieceTypes.anyOf) || [];
      const label =
        Array.isArray(kinds) && kinds.length
          ? kinds.join(", ")
          : "pieces";
      const count = Math.max(1, Number(verb.count ?? 1));
      return `Convert up to ${count} ${label} from ${from} to ${to} at your character`;
    }
    case "destroyAtCharacter": {
      const from = verb.fromFaction ? ` (${String(verb.fromFaction)})` : "";
      const kinds = (verb.pieceTypes && verb.pieceTypes.anyOf) || [];
      const label =
        Array.isArray(kinds) && kinds.length
          ? kinds.join(", ")
          : "pieces";
      const count = Math.max(1, Number(verb.count ?? 1));
      return `Destroy up to ${count} ${label}${from} at your character`;
    }
    case "retreatAtCharacter": {
      const fac = String(verb.faction ?? "faction");
      return `Retreat ${fac} units and characters from your character's city`;
    }
    case "trashTuckedCard": {
      const id = String(verb.matchCardId ?? "card");
      const tgt =
        verb.target === "opponent"
          ? "an opponent"
          : (verb.target && (verb.target as any).playerId)
          ? "a player"
          : "you";
      return `Trash tucked card ${id} in front of ${tgt}`;
    }
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
  displayIcons: string[],
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
  const tokens = Array.isArray(displayIcons) ? displayIcons.filter(Boolean) : [];
  const hasIcons = tokens.length > 0;
  // Determine a primary faction from icon tokens (used to color unqualified piece icons)
  const primaryFaction = (tokens.find((t) => t === 'song' || t === 'jin' || t === 'daqi' || t === 'rebel') as FactionId | undefined);
  const unitWidth = (r * 2) + gap;
  const spanOf = (tok: string) => String(tok).startsWith('war') ? 2 : 1;
  const totalUnits = tokens.reduce((s, t) => s + spanOf(String(t)), 0);
  const totalW = totalUnits * (r * 2) + (totalUnits - 1) * gap;
  const startX = bandX + (bandW - totalW) / 2 + r;
  const cy = bandY + bandH / 2;
  let iconsMarkup = "";
  let u = 0; // unit cursor
  tokens.forEach((tok) => {
    const span = spanOf(String(tok));
    const cx = span === 1 ? (startX + u * unitWidth) : (startX + u * unitWidth + unitWidth / 2);
    if (tok === 'character') {
      const initials = name.split(/\s+/).map(s=>s[0]||'').join('').slice(0,2).toUpperCase();
      iconsMarkup += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="#222" stroke-width="2"/>
        <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="16" font-weight="700" fill="#111">${initials}</text>`;
    } else if (tok === 'song' || tok === 'jin' || tok === 'daqi' || tok === 'rebel') {
      const f = tok as FactionId;
      const fill = (FactionColor as any)[f] || "#666";
      const char = getFactionHan(f);
      const textFill = f === "jin" ? "#111" : "#fff";
      iconsMarkup += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#222" stroke-width="2"/>
        <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="16" font-weight="700" fill="${textFill}">${char}</text>`;
    } else if (String(tok).startsWith('war')) {
      // war-jin-song or war:jin:song
      const parts = String(tok).includes(':') ? String(tok).split(':') : String(tok).split('-');
      const fa = (parts[1] || '').toLowerCase() as FactionId;
      const fb = (parts[2] || '').toLowerCase() as FactionId;
      const fillA = (FactionColor as any)[fa] || '#999';
      const fillB = (FactionColor as any)[fb] || '#999';
      const charA = getFactionHan(fa);
      const charB = getFactionHan(fb);
      const textFillA = fa === 'jin' ? '#111' : '#fff';
      const textFillB = fb === 'jin' ? '#111' : '#fff';
      const rr = r; // use full radius for clarity
      const leftX = cx - (unitWidth / 2);
      const rightX = cx + (unitWidth / 2);
      iconsMarkup += `<g>
        <circle cx="${leftX}" cy="${cy}" r="${rr}" fill="${fillA}" stroke="#222" stroke-width="2"/>
        <text x="${leftX}" y="${cy + 6}" text-anchor="middle" font-size="14" font-weight="800" fill="${textFillA}">${charA}</text>
        <circle cx="${rightX}" cy="${cy}" r="${rr}" fill="${fillB}" stroke="#222" stroke-width="2"/>
        <text x="${rightX}" y="${cy + 6}" text-anchor="middle" font-size="14" font-weight="800" fill="${textFillB}">${charB}</text>
        <path d="M ${cx-6} ${cy-10} L ${cx+6} ${cy+10}" stroke="#111" stroke-width="3"/>
        <path d="M ${cx-6} ${cy+10} L ${cx+6} ${cy-10}" stroke="#111" stroke-width="3"/>
      </g>`;
    } else {
      // Treat any other token as a specific character icon; render initials from token
      const words = String(tok).split(/[^A-Za-z]+/).filter(Boolean);
      const initials = words.map(w => w[0] || '').join('').slice(0,2).toUpperCase();
      iconsMarkup += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="#222" stroke-width="2"/>
        <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="16" font-weight="700" fill="#111">${initials}</text>`;
    }
    u += span;
  });
  // Rules text block (baked into SVG) — place higher up under title
  let rulesMarkup = "";
  let rulesBottomY = 0;
  if (rulesText && rulesText.trim()) {
    // Inline icon rendering using vectors matching board pieces
    let effectiveRules = rulesText;

    // Measurement helpers
    const fontSize = 13;
    const FONT_FAMILY =
      "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    // Precise text measurement using an offscreen SVG measurer
    const __msvg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    __msvg.setAttribute("width", "0");
    __msvg.setAttribute("height", "0");
    (__msvg.style as any).position = "fixed";
    (__msvg.style as any).left = "-9999px";
    const __mtext = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    __mtext.setAttribute("font-size", String(fontSize));
    __mtext.setAttribute("font-family", FONT_FAMILY);
    __msvg.appendChild(__mtext);
    document.body.appendChild(__msvg);
    __mtext.setAttribute("xml:space", "preserve");
    const iconH = 12;
    function widthOfText(s: string, isBold?: boolean): number {
      if (!s) return 0;
      // Robust space width: measure "x x" - "xx" to avoid zero-width space bugs
      try { __mtext.setAttribute('font-weight', isBold ? '700' : '400'); } catch {}
      let spaceWidth = fontSize * 0.33;
      try {
        __mtext.textContent = 'x x';
        const withSpace = (__mtext as any).getComputedTextLength?.() as number | undefined;
        __mtext.textContent = 'xx';
        const noSpace = (__mtext as any).getComputedTextLength?.() as number | undefined;
        const diff = (withSpace ?? 0) - (noSpace ?? 0);
        if (diff && diff > 0) spaceWidth = diff;
      } catch {}
      if (/^\s+$/.test(s)) return s.length * spaceWidth;
      try {
        __mtext.textContent = s;
        const w = (__mtext as any).getComputedTextLength?.() as
          | number
          | undefined;
        if (typeof w === "number" && isFinite(w)) return w;
      } catch {}
      // Fallback rough estimate if measurement fails
      const avgChar = fontSize * 0.58;
      const spaces = (s.match(/\s/g) || []).length;
      const non = s.length - spaces;
      return non * avgChar + spaces * spaceWidth;
    }
    function iconWidth(kind: string): number {
      if (kind === "ship") return iconH; // narrower footprint; diagonal rendering
      if (kind === "capital") return Math.round(iconH * 2); // capital can be twice as wide as a normal emoji
      if (kind === "character") return iconH;
      if (kind === "dagger") return Math.round(iconH * 1.2);
      return iconH; // foot, horse, dot, star
    }
    // Inline SVG icon generator for on-card rendering (fonts can't load inside data: SVG reliably)
    function iconMarkup(kind: string, faction?: FactionId): string {
      if (kind === "dot") {
        // Yellow diamond (rotated square) to distinguish from coins
        const pts = [[6,2],[10,6],[6,10],[2,6]].map(p=>p.join(',')).join(' ');
        return `<polygon points="${pts}" fill="#f0c419" stroke="#b78900" stroke-width="1"/>`;
      }
      if (kind === "star") {
        const R = 5,
          r2 = 2.2;
        const cx = 6,
          cy = 6;
        const pts: Array<[number, number]> = [];
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 === 0 ? R : r2;
          pts.push([cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)]);
        }
        const d =
          `M ${pts[0][0]} ${pts[0][1]} ` +
          pts
            .slice(1)
            .map((p) => `L ${p[0]} ${p[1]}`)
            .join(" ") +
          " Z";
        return `<path d="${d}" fill="#000" stroke="#000" stroke-width="0.5"/>`;
      }
      if (kind === "foot") {
        const fill = faction
          ? (FactionColor as any)[faction] ?? "#888"
          : "#fff";
        const stroke = faction ? "#000" : "#000";
        return `<rect x="0" y="0" width="12" height="12" rx="2" ry="2" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      }
      if (kind === "horse") {
        const fill = faction
          ? (FactionColor as any)[faction] ?? "#888"
          : "#fff";
        return `<polygon points="6,0 0,12 12,12" fill="${fill}" stroke="#000" stroke-width="2"/>`;
      }
      if (kind === "coin") {
        // Coin with square hole: outer circle + inner square cutout (simulate hole by overlaying background color)
        const outer = `<circle cx="6" cy="6" r="6" fill="#f0c419" stroke="#b78900" stroke-width="1.5"/>`;
        const hole = `<rect x="4" y="4" width="4" height="4" fill="#f9f9f9" />`;
        return `<g>${outer}${hole}</g>`;
      }
      if (kind === "dagger") {
        // simple dagger glyph in 12x12
        return `<g transform="translate(6,6) rotate(-20)"><rect x="-0.6" y="-5" width="1.2" height="7" fill="#555" stroke="#111" stroke-width="0.5"/><path d="M -1.8,1 L 1.8,1 L 0,4 Z" fill="#222"/></g>`;
      }
      if (kind === "ship") {
        const fill = faction
          ? (FactionColor as any)[faction] ?? "#888"
          : "#fff";
        // Diagonal bar centered in 12x12 box
        // Draw a 10x4 rounded rect rotated -30 degrees about center (6,6)
        const rw = 10,
          rh = 4;
        const cx = 6,
          cy = 6;
        return `<g transform="translate(${cx},${cy}) rotate(-30)"><rect x="${
          -rw / 2
        }" y="${
          -rh / 2
        }" width="${rw}" height="${rh}" rx="2" ry="2" fill="${fill}" stroke="#000" stroke-width="2"/></g>`;
      }
      if (kind === "capital") {
        // Inline capital path inside a nested SVG so it scales reliably in data-URL SVGs
        const pathD = `M 1056,252.023 V 240 H 852 v -60 l 36,-12 -66,-24 V 132 L 852,108 792,84 780,24 V 12 C 780,5.3633 774.6367,0 768,0 761.3633,0 756,5.3633 756,12 V 24 H 324 V 12 C 324,5.3633 318.6367,0 312,0 305.3633,0 300,5.3633 300,12 v 12 l -12,60 -60,24 30,24 v 12 l -66,24 36,12 v 60 H 24 v 12.012 L 0,384.002 h 240 v -30 c 0,-9.9375 8.0625,-18 18,-18 9.9375,0 18,8.0625 18,18 v 30 h 96 v -36 c 0,-13.246 10.754,-24 24,-24 13.246,0 24,10.754 24,24 v 36 h 90 v -42 c 0,-16.57 13.43,-30 30,-30 16.57,0 30,13.43 30,30 v 42 h 90 v -36 c 0,-13.246 10.754,-24 24,-24 13.246,0 24,10.754 24,24 v 36 h 96 v -30 c 0,-9.9375 8.0625,-18 18,-18 9.9375,0 18,8.0625 18,18 v 30 h 240 z M 462,240 h -24 v -48 h 24 z m 96,0 h -36 v -48 h 36 z m 84,0 h -24 v -48 h 24 z`;
        const fill = faction ? ((FactionColor as any)[faction] ?? "#000") : "#000";
        return `<svg x="0" y="0" width="24" height="12" viewBox="0 0 1080 384" preserveAspectRatio="xMidYMid meet"><path d="${pathD}" fill="${fill}"/></svg>`;
      }
      if (kind === "character") {
        const f = faction ? (FactionColor as any)[faction] ?? "#000" : "#000";
        return `<circle cx="6" cy="6" r="6" fill="#fff" stroke="${f}" stroke-width="2"/>`;
      }
      return "";
    }
    type Item =
      | { kind: "text"; text: string }
      | { kind: "bold"; text: string }
      | { kind: "icon"; which: string; faction?: FactionId };
    const tokenRe =
      /:((rebel|black|song|red|jin|yellow|daqi|green)-)?(foot|horse|ship|capital|character|dot|star|dagger|coin):/g;
    function resolveRefTitle(id: string): string {
      try {
        const cat = (window as any).__cardCatalog as
          | Record<string, any>
          | undefined;
        const dict = (window as any).__scenarioCardDict as
          | Record<string, any>
          | undefined;
        return (
          (cat && cat[id] && cat[id].name) ||
          (dict && dict[id] && String(dict[id].name || dict[id].title || id)) ||
          id
        );
      } catch {
        return id;
      }
    }
    function pushTextWithRefs(out: Item[], text: string) {
      const refRe = /\[\[([\w:-]+)\]\]/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = refRe.exec(text)) !== null) {
        const start = m.index;
        const end = refRe.lastIndex;
        if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
        out.push({ kind: "bold", text: resolveRefTitle(String(m[1])) });
        last = end;
      }
      if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
    }
    function parseParagraph(par: string): Item[] {
      const out: Item[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(par)) !== null) {
        const start = m.index;
        const end = tokenRe.lastIndex;
        if (start > last) pushTextWithRefs(out, par.slice(last, start));
        const facStr = (m[2] || "").toLowerCase();
        const which = m[3].toLowerCase();
        let faction: FactionId | undefined = undefined;
        if (facStr === "rebel" || facStr === "black")
          faction = "rebel" as FactionId;
        if (facStr === "song" || facStr === "red")
          faction = "song" as FactionId;
        if (facStr === "jin" || facStr === "yellow")
          faction = "jin" as FactionId;
        if (facStr === "daqi" || facStr === "green")
          faction = "daqi" as FactionId;
        if (!faction && (which === "foot" || which === "horse" || which === "ship" || which === "capital" || which === "character")) {
          faction = primaryFaction;
        }
        out.push({ kind: "icon", which, faction });
        last = end;
      }
      if (last < par.length) pushTextWithRefs(out, par.slice(last));
      return out;
    }
    function wrapItems(items: Item[], maxW: number): Item[][] {
      const lines: Item[][] = [];
      let current: Item[] = [];
      let used = 0;
      const pushLine = () => {
        if (current.length) lines.push(current);
        current = [];
        used = 0;
      };
      for (const it of items) {
        if (it.kind === "text" || it.kind === "bold") {
          // split by spaces but preserve spaces
          const parts = it.text.split(/(\s+)/);
          for (const p of parts) {
            if (!p) continue;
            const w = widthOfText(p, it.kind === 'bold');
            if (used + w > maxW && used > 0) pushLine();
            current.push({ kind: it.kind, text: p } as any);
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

    const startY = 110;
    const lineGap = 16;
    const groupGap = 8;
    let yCursor = startY;
    let parts: string[] = [];
    const paragraphs = effectiveRules
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const items = parseParagraph(paragraphs[pIdx]);
      const lines = wrapItems(items, bandW);
      for (let li = 0; li < lines.length; li++) {
        let x = bandX;
        for (const it of lines[li]) {
          if (it.kind === "text" || it.kind === "bold") {
            const w = widthOfText(it.text, it.kind === 'bold');
            if (/^\s+$/.test(it.text)) {
              // advance only; rely on positioning for visual spaces
              x += w;
            } else {
              const safe = it.text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
              parts.push(
                `<text x="${x}" y="${yCursor}" font-size="${fontSize}" font-family="${FONT_FAMILY}" fill="#222" font-weight="${it.kind === 'bold' ? '700' : '400'}" xml:space="preserve">${safe}</text>`
              );
              x += w;
            }
          } else {
            const w = iconWidth(it.which);
            const tx = x;
            const ty = yCursor - 10; // baseline adjust
            parts.push(
              `<g transform="translate(${tx}, ${ty})">${iconMarkup(
                it.which,
                it.faction
              )}</g>`
            );
            x += w + 2;
          }
        }
        yCursor += lineGap;
      }
      // paragraph gap
      yCursor += groupGap;
    }
    rulesBottomY = yCursor - groupGap;
    rulesMarkup = parts.join("");
    // Clean up measurer
    try {
      __msvg.remove();
    } catch {}
  }

  // Quote block above icon band — ensure no overlap with rules text
  let quoteMarkup = "";
  if (quote && quote.text) {
    const rawQ = quote.text;
    const qLines = wrapTextToLines(rawQ, bandW, 13, 8).map((s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    );
    const c = quote.cite ? quote.cite.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
    const minY = rulesBottomY ? rulesBottomY + 10 : 90;
    // Determine the lowest safe baseline based on whether an icon band is present
    const targetBottom = hasIcons ? (bandY - 10) : (TAROT_CARD_HEIGHT - SAFE_MARGIN_TOP - 10);
    const quoteBlockHeight = qLines.length * 14 + (c ? 12 : 0);
    // Place the quote so that its bottom (including cite) sits at or above targetBottom
    const baseY = Math.max(minY, targetBottom - quoteBlockHeight);
    const tspans = qLines
      .map(
        (ln, i) => `<tspan x="${bandX}" dy="${i === 0 ? 0 : 14}">${ln}</tspan>`
      )
      .join("");
    const naturalCiteY = baseY + qLines.length * 14 + 12;
    const citeY = Math.min(targetBottom, naturalCiteY);
    quoteMarkup = `
  <text x="${bandX}" y="${baseY}" text-anchor="start" font-size="13" fill="#333" font-style="italic">${tspans}</text>
  ${
    c
      ? `<text x="${bandX}" y="${citeY}" text-anchor="start" font-size="11" fill="#444">— ${c}</text>`
      : ""
  }
`;
  }

  // Measure header lines and auto-fit if too wide (use a transient measurer to avoid scope issues)
  const headerMaxW = TAROT_CARD_WIDTH - 60;
  const __hsvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  const __htext = document.createElementNS('http://www.w3.org/2000/svg','text');
  __hsvg.appendChild(__htext);
  document.body.appendChild(__hsvg);
  __htext.setAttribute('font-size','20');
  __htext.textContent = name;
  const nameW = (((__htext as any).getComputedTextLength?.()) as number | undefined) ?? 0;
  __htext.setAttribute('font-size','16');
  __htext.textContent = title;
  const titleW = (((__htext as any).getComputedTextLength?.()) as number | undefined) ?? 0;
  try { __hsvg.remove(); } catch {}
  const nameAttrs = nameW > headerMaxW ? ` lengthAdjust="spacingAndGlyphs" textLength="${headerMaxW}"` : '';
  const titleAttrs = titleW > headerMaxW ? ` lengthAdjust="spacingAndGlyphs" textLength="${headerMaxW}"` : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
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
  <text x="50%" y="42" text-anchor="middle" font-size="20" font-weight="700" fill="#111"${nameAttrs}>${(name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text>
  ${title ? `<text x="50%" y="70" text-anchor="middle" font-size="16" fill="#333"${titleAttrs}>${title}</text>` : ``}
  ${quoteMarkup}
  ${rulesMarkup}
  ${hasIcons ? `<rect x="${bandX}" y="${bandY}" width="${bandW}" height="${bandH}" fill="#eee" rx="8" ry="8"/>` : ``}
  ${hasIcons ? iconsMarkup : ``}
</svg>`;
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return `data:image/svg+xml;charset=UTF-8,${encoded}`;
}

function makeCardBackDataUrl(text?: string): string {
  const width = TAROT_CARD_WIDTH;
  const height = TAROT_CARD_HEIGHT;
  const label = (text || '').trim();
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="backGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d3b66"/>
      <stop offset="100%" stop-color="#144e81"/>
    </linearGradient>
    <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
      <rect width="16" height="16" fill="#0f4476"/>
      <path d="M0 0 L16 0 16 16" stroke="#0c3863" stroke-width="1"/>
    </pattern>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#backGrad)"/>
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="url(#grid)" rx="12" ry="12" opacity="0.5"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#ffffff" stroke-width="4" rx="12" ry="12"/>
  ${label ? `<text x="50%" y="50%" text-anchor="middle" font-size="48" font-weight="800" fill="#fff" dy="18" lengthAdjust="spacingAndGlyphs" textLength="${width - 120}">${label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text>` : ''}
  ${label ? `<text x="50%" y="50%" text-anchor="middle" font-size="12" fill="#cfe8ff" dy="-30">${'—'.repeat(Math.min(12, Math.max(0, Math.floor(label.length/2))))}</text>` : ''}
</svg>`;
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return `data:image/svg+xml;charset=UTF-8,${encoded}`;
}

function makeGenericCardDataUrl(
  name: string,
  rulesText?: string,
  backText?: string,
  quote?: { text: string; cite?: string }
): string {
  const width = TAROT_CARD_WIDTH;
  const height = TAROT_CARD_HEIGHT;
  const safeName = (name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Inline icon + text layout with measurement (so tokens like :dagger: render inline and wrap)
  const FONT_FAMILY = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const fontSize = 14;
  const bandX = 30;
  const bandW = TAROT_CARD_WIDTH - 60;
  // Measurer
  const __msvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  __msvg.setAttribute('width','0'); __msvg.setAttribute('height','0');
  (__msvg.style as any).position = 'fixed'; (__msvg.style as any).left='-9999px';
  const __mtext = document.createElementNS('http://www.w3.org/2000/svg','text');
  __mtext.setAttribute('font-size', String(fontSize));
  __mtext.setAttribute('font-family', FONT_FAMILY);
  __mtext.setAttribute('xml:space','preserve');
  __msvg.appendChild(__mtext); document.body.appendChild(__msvg);
  const iconH = 12;
  function widthOfText(s: string): number {
    if (!s) return 0;
    const spaces = (s.match(/\s/g) || []).length; const non = s.length - spaces;
    let spaceWidth = fontSize * 0.33; // fallback
    try {
      __mtext.textContent = 'x x'; const withSpace = (__mtext as any).getComputedTextLength?.() ?? 0;
      __mtext.textContent = 'xx'; const noSpace = (__mtext as any).getComputedTextLength?.() ?? 0;
      const diff = withSpace - noSpace; if (diff > 0) spaceWidth = diff;
    } catch {}
    if (/^\s+$/.test(s)) return spaces * spaceWidth;
    try { __mtext.textContent = s; const w = (__mtext as any).getComputedTextLength?.(); if (typeof w === 'number' && isFinite(w)) return w; } catch {}
    const avgChar = 7; return non * avgChar + spaces * spaceWidth;
  }
  function iconWidth(kind: string): number {
    if (kind === 'ship') return iconH;
    if (kind === 'capital') return Math.round(iconH * 2);
    if (kind === 'character') return iconH;
    if (kind === 'dagger') return Math.round(iconH * 1.2);
    return iconH;
  }
  function iconMarkup(kind: string, faction?: FactionId): string {
    if (kind === 'dot') { const pts = [[6,2],[10,6],[6,10],[2,6]].map(p=>p.join(',')).join(' '); return `<polygon points="${pts}" fill="#f0c419" stroke="#b78900" stroke-width="1"/>`; }
    if (kind === 'star') {
      const R=5, r2=2.2, cx=6, cy=6; const pts: Array<[number,number]> = [];
      for (let i=0;i<10;i++){ const ang=-Math.PI/2 + i*Math.PI/5; const rr=i%2===0?R:r2; pts.push([cx+rr*Math.cos(ang), cy+rr*Math.sin(ang)]); }
      const d = `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(p=>`L ${p[0]} ${p[1]}`).join(' ') + ' Z';
      return `<path d="${d}" fill="#000" stroke="#000" stroke-width="0.5"/>`;
    }
    if (kind === 'foot') {
      const fill = faction ? (FactionColor as any)[faction] ?? '#888' : '#fff';
      return `<rect x="0" y="0" width="12" height="12" rx="2" ry="2" fill="${fill}" stroke="#000" stroke-width="2"/>`;
    }
    if (kind === 'horse') {
      const fill = faction ? (FactionColor as any)[faction] ?? '#888' : '#fff';
      return `<polygon points="6,0 0,12 12,12" fill="${fill}" stroke="#000" stroke-width="2"/>`;
    }
    if (kind === 'dagger') {
      return `<g transform="translate(6,6) rotate(-20)"><rect x="-0.6" y="-5" width="1.2" height="7" fill="#555" stroke="#111" stroke-width="0.5"/><path d="M -1.8,1 L 1.8,1 L 0,4 Z" fill="#222"/></g>`;
    }
    if (kind === 'ship') {
      const fill = faction ? (FactionColor as any)[faction] ?? '#888' : '#fff';
      const rw=10, rh=4, cx=6, cy=6;
      return `<g transform="translate(${cx},${cy}) rotate(-30)"><rect x="${-rw/2}" y="${-rh/2}" width="${rw}" height="${rh}" rx="2" ry="2" fill="${fill}" stroke="#000" stroke-width="2"/></g>`;
    }
    if (kind === 'capital') {
      const pathD = `M 1056,252.023 V 240 H 852 v -60 l 36,-12 -66,-24 V 132 L 852,108 792,84 780,24 V 12 C 780,5.3633 774.6367,0 768,0 761.3633,0 756,5.3633 756,12 V 24 H 324 V 12 C 324,5.3633 318.6367,0 312,0 305.3633,0 300,5.3633 300,12 v 12 l -12,60 -60,24 30,24 v 12 l -66,24 36,12 v 60 H 24 v 12.012 L 0,384.002 h 240 v -30 c 0,-9.9375 8.0625,-18 18,-18 9.9375,0 18,8.0625 18,18 v 30 h 96 v -36 c 0,-13.246 10.754,-24 24,-24 13.246,0 24,10.754 24,24 v 36 h 90 v -42 c 0,-16.57 13.43,-30 30,-30 16.57,0 30,13.43 30,30 v 42 h 90 v -36 c 0,-13.246 10.754,-24 24,-24 13.246,0 24,10.754 24,24 v 36 h 96 v -30 c 0,-9.9375 8.0625,-18 18,-18 9.9375,0 18,8.0625 18,18 v 30 h 240 z M 462,240 h -24 v -48 h 24 z m 96,0 h -36 v -48 h 36 z m 84,0 h -24 v -48 h 24 z`;
      const fill = faction ? ((FactionColor as any)[faction] ?? '#000') : '#000';
      return `<svg x="0" y="0" width="24" height="12" viewBox="0 0 1080 384" preserveAspectRatio="xMidYMid meet"><path d="${pathD}" fill="${fill}"/></svg>`;
    }
    if (kind === 'character') {
      const f = faction ? (FactionColor as any)[faction] ?? '#000' : '#000';
      return `<circle cx="6" cy="6" r="6" fill="#fff" stroke="${f}" stroke-width="2"/>`;
    }
    if (kind === 'coin') { const outer = `<circle cx="6" cy="6" r="6" fill="#f0c419" stroke="#b78900" stroke-width="1.5"/>`; const hole = `<rect x="4" y="4" width="4" height="4" fill="#f9f9f9"/>`; return `<g>${outer}${hole}</g>`; }
    return '';
  }
  type Item = { kind:'text'; text:string } | { kind:'bold'; text:string } | { kind:'icon'; which:string; faction?: FactionId };
  const tokenRe = /:((rebel|black|song|red|jin|yellow|daqi|green)-)?(foot|horse|ship|capital|character|dot|star|dagger|coin):/g;
  function resolveRefTitle(id: string): string {
    try {
      const cat = (window as any).__cardCatalog as Record<string, any> | undefined;
      const dict = (window as any).__scenarioCardDict as Record<string, any> | undefined;
      return (cat && cat[id] && cat[id].name) || (dict && dict[id] && String(dict[id].name || dict[id].title || id)) || id;
    } catch { return id; }
  }
  function pushTextWithRefs(out: Item[], text: string) {
    const refRe = /\[\[([\w:-]+)\]\]/g; let last = 0; let m: RegExpExecArray | null;
    while ((m = refRe.exec(text)) !== null) {
      const start = m.index; const end = refRe.lastIndex;
      if (start > last) out.push({ kind:'text', text: text.slice(last, start) });
      out.push({ kind:'bold', text: resolveRefTitle(String(m[1])) });
      last = end;
    }
    if (last < text.length) out.push({ kind:'text', text: text.slice(last) });
  }
  function parseParagraph(par: string): Item[] {
    const out: Item[] = []; let last = 0; let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(par)) !== null) {
      const start = m.index; const end = tokenRe.lastIndex;
      if (start > last) pushTextWithRefs(out, par.slice(last, start));
      const facStr = (m[2]||'').toLowerCase(); const which = m[3].toLowerCase();
      let faction: FactionId | undefined = undefined;
      if (facStr === 'rebel' || facStr === 'black') faction = 'rebel' as FactionId;
      if (facStr === 'song' || facStr === 'red') faction = 'song' as FactionId;
      if (facStr === 'jin' || facStr === 'yellow') faction = 'jin' as FactionId;
      if (facStr === 'daqi' || facStr === 'green') faction = 'daqi' as FactionId;
      out.push({ kind:'icon', which, faction }); last = end;
    }
    if (last < par.length) pushTextWithRefs(out, par.slice(last));
    return out;
  }
  function wrapItems(items: Item[], maxW: number): Item[][] {
    const lines: Item[][] = []; let line: Item[] = []; let used = 0;
    const push = () => { if (line.length) lines.push(line); line = []; used = 0; };
    for (const it of items) {
      if (it.kind === 'text' || it.kind === 'bold') {
        const parts = it.text.split(/(\s+)/);
        for (const p of parts) { if (!p) continue; const w = widthOfText(p); if (used + w > maxW && used > 0) push(); line.push({ kind: it.kind, text:p } as any); used += w; }
      } else {
        const w = iconWidth(it.which); if (used + w > maxW && used > 0) push(); line.push(it); used += w + 2;
      }
    }
    if (line.length) lines.push(line); return lines;
  }
  const paragraphs = (rulesText || '').split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const startY = 110; const lineGap = 16; let y = startY; let rulesMarkup = '';
  for (const par of paragraphs) {
    const items = parseParagraph(par); const lines = wrapItems(items, bandW);
      for (const ln of lines) {
      let x = bandX;
      for (const it of ln) {
          if ((it as any).kind === 'text' || (it as any).kind === 'bold') {
          const t = (it as any).text as string; const w = widthOfText(t);
          const safe = t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const weight = (it as any).kind === 'bold' ? '700' : '400';
            rulesMarkup += `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="${FONT_FAMILY}" fill="#222" font-weight="${weight}" xml:space="preserve">${safe}</text>`;
          x += w;
        } else {
          const itc = it as any; const w = iconWidth(itc.which); const tx = x; const ty = y - 10;
          rulesMarkup += `<g transform="translate(${tx}, ${ty})">${iconMarkup(itc.which, itc.faction)}</g>`; x += w + 2;
        }
      }
      y += lineGap;
    }
    y += 8; // paragraph gap
  }
  // Measure generic card header and apply auto-fit
  const headerMaxW = TAROT_CARD_WIDTH - 60;
  const __origHeaderSize = __mtext.getAttribute('font-size') || String(fontSize);
  try { __mtext.setAttribute('font-size','22'); __mtext.textContent = name || ''; } catch {}
  const __headW = ( (__mtext as any).getComputedTextLength?.() as number | undefined) ?? 0;
  const headAttrs = __headW > headerMaxW ? ` lengthAdjust="spacingAndGlyphs" textLength="${headerMaxW}"` : '';
  try { __mtext.setAttribute('font-size', __origHeaderSize || String(fontSize)); } catch {}
  // cleanup measurer
  try { __msvg.remove(); } catch {}
  // Quote placement below rules
  let quoteBlock = '';
  if (quote && quote.text) {
    const qLines = wrapTextToLines(String(quote.text), bandW, 13, 8).map(s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
    const tsp = qLines.map((ln,i)=>`<tspan x="${bandX}" dy="${i===0?0:14}">${ln}</tspan>`).join('');
    const cite = quote.cite ? `— ${String(quote.cite).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}` : '';
    quoteBlock = `\n  <text x="${bandX}" y="${y+8}" text-anchor="start" font-size="13" fill="#333" font-style="italic">${tsp}</text>\n  ${cite ? `<text x="${bandX}" y="${y + 8 + qLines.length*14 + 12}" text-anchor="start" font-size="11" fill="#444">${cite}</text>` : ''}`;
  }
  const back = backText ? `<defs><style type="text/css"><![CDATA[@font-face{font-family:'PieceIcons';src:url('/fonts/piece-icons.woff2') format('woff2'),url('/fonts/piece-icons.ttf') format('truetype');}]]></style></defs>` : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${back}
  <rect x="0" y="0" width="${width}" height="${height}" fill="#f9f9f9" rx="12" ry="12"/>
  <text x="50%" y="56" text-anchor="middle" font-size="22" font-weight="800" fill="#111"${headAttrs}>${safeName}</text>
  ${rulesMarkup}
  ${quoteBlock}
  ${hasIcons ? `<rect x="${bandX}" y="${bandY}" width="${bandW}" height="${bandH}" fill="#eee" rx="8" ry="8"/>` : ``}
  ${hasIcons ? iconsMarkup : ``}
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
    c.asset = { ...(def.asset as any) };
    const asset = c.asset as any;
    if (!asset.backPath && (def as any).backText) {
      asset.backPath = makeCardBackDataUrl(String((def as any).backText));
    }
  } else if (def.template === "character") {
    const title = String(def.title ?? "");
    const displayIcons = Array.isArray(def.icons)
      ? (def.icons as string[])
      : [];
    const rulesText =
      (c as any).rulesTextOverride ||
      describeCardRules({ verbs: c.verbs, effect: (c as any).effect });
    const path = makeCharacterCardDataUrl(
      name,
      title,
      displayIcons,
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
    // Ensure every card has a back
    const backLabel = String((def as any).backText || "Card");
    c.asset.backPath = makeCardBackDataUrl(backLabel);
  }
  // If no asset or non-character template, render using character style for consistency
  if (!c.asset) {
    const title = String(def.title ?? "");
    const displayIcons = Array.isArray(def.icons)
      ? (def.icons as string[])
      : [];
    const rulesText = (c as any).rulesTextOverride || (def as any).rulesTextOverride || '';
    const path = makeCharacterCardDataUrl(name, title, displayIcons, (def as any).quote || (c as any).quote, rulesText);
    c.asset = {
      path,
      size: { width: TAROT_CARD_WIDTH, height: TAROT_CARD_HEIGHT },
      // Always provide a back, defaulting to a generic label if none specified
      backPath: makeCardBackDataUrl(String((def as any).backText || "Card")),
      iconSlot: {
        x: ICON_BAND_X,
        y: ICON_BAND_Y,
        width: ICON_BAND_W,
        height: ICON_BAND_H,
      },
    } as any;
  }
  return c;
}

// Expose for engine fallback (e.g., addCardToHand resolving scenario-only cards)
try { (window as any).__materializeCard = materializeCardFromDef; } catch {}

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
    const rawNodeId = ch.nodeId !== undefined && ch.nodeId !== null ? String(ch.nodeId) : '';
    let location: any;
    if (!rawNodeId || rawNodeId === 'offboard') {
      location = { kind: 'offboard' };
    } else if (validNodes.has(rawNodeId)) {
      location = { kind: 'node', nodeId: rawNodeId };
    } else {
      console.warn(`[scenario] Unknown nodeId: ${rawNodeId}; placing character offboard`);
      location = { kind: 'offboard' };
    }
    characters[id] = {
      id,
      name,
      playerId: playerId || id,
      faction,
      location,
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

  // Auto-include all cards with backText "Jingkang" in the starting draw pile
  try {
    const existing = new Set(drawPile.cards.map((c) => c.id));
    for (const [cid, def] of Object.entries(cardDict)) {
      if (def && typeof def === 'object' && String((def as any).backText || '') === 'Jingkang') {
        if (!existing.has(cid)) {
          drawPile.cards.push(materializeCardFromDef({ id: cid, ...(def as any) }));
          existing.add(cid);
        }
      }
    }
    // Also include any cards listed in scenario decks.*.cards (e.g., event, ops)
    if (scn.decks && typeof scn.decks === 'object') {
      for (const deck of Object.values(scn.decks) as any[]) {
        if (deck && Array.isArray(deck.cards)) {
          for (const cid of deck.cards) {
            if (!existing.has(cid) && cardDict[cid]) {
              drawPile.cards.push(materializeCardFromDef({ id: cid, ...(cardDict[cid] as any) }));
              existing.add(cid);
            }
          }
        }
      }
    }
  } catch {}

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
  // Build a card catalog for in-game references (e.g., addCardToHand)
  try {
    const catalog: Record<string, any> = {};
    for (const [cid, def] of Object.entries(cardDict)) {
      try {
        catalog[cid] = materializeCardFromDef({ id: cid, ...(def as any) });
      } catch (e) {
        // Fallback: ensure card still exists in catalog with a generic face
        try {
          const name = String((def as any).name || cid);
          const rules = String((def as any).rulesTextOverride || '');
          const backText = String((def as any).backText || 'Card');
          const quote = (def as any).quote;
          const assetPath = makeGenericCardDataUrl(name, rules, backText, quote);
          catalog[cid] = {
            id: cid,
            name,
            verbs: [],
            rulesTextOverride: rules,
            asset: {
              path: assetPath,
              size: { width: TAROT_CARD_WIDTH, height: TAROT_CARD_HEIGHT },
              backPath: makeCardBackDataUrl(backText),
            },
          };
        } catch {
          // Last resort: minimal placeholder
          catalog[cid] = { id: cid, name: String((def as any).name || cid), verbs: [] };
        }
      }
    }
    (state as any).cardCatalog = catalog;
    try { (window as any).__cardCatalog = catalog; } catch {}
    // Keep a copy of raw scenario definitions available to the engine
    (state as any).scenarioCardDict = cardDict;
  } catch {}
  // Randomly deal identity (character) cards to players and bind characters to owners
  try {
    // Collect all character card ids from scenario
    const characterCardIds: string[] = Object.entries(cardDict)
      .filter(([, def]) => def && typeof def === 'object' && def.template === 'character' && String((def as any).backText || '') === 'START')
      .map(([id]) => id);
    if (characterCardIds.length > 0 && players.length > 0) {
      // Remove any character cards from hands first
      players.forEach((p: any) => {
        p.hand = (p.hand || []).filter((c: any) => !characterCardIds.includes(c.id));
      });
      // Shuffle the character cards
      const pool = [...characterCardIds];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const dealCount = Math.min(pool.length, players.length);
      // Log start of dealing without revealing identities
      state.log.push({ message: `Dealing identity cards...` });
      for (let i = 0; i < dealCount; i++) {
        const cardId = pool[i];
        const def = cardDict[cardId];
        const dealt = materializeCardFromDef({ id: cardId, ...(def || {}) });
        players[i].hand.push(dealt);
        // Public log: do not reveal which identity
        state.log.push({ message: `${players[i].name} receives an identity card.` });
        // Reassign character ownership to the player who received this identity
        const targetName = dealt.name;
        const chEntry = Object.entries(characters).find(([, ch]) => ch.name === targetName);
        if (chEntry) {
          const [cid, ch] = chEntry as [string, Character];
          characters[cid] = { ...ch, playerId: players[i].id } as Character;
        }
      }
    }
  } catch {}
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
