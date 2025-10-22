# Jingkang Incident – Card Verb System (Prototype)

A lightweight, vanilla TypeScript + Vite prototype for a reusable point-to-point, card-driven game engine ("Card Verb System").

### Core Concepts
- **Map**: Point-to-point nodes and edges (roads, rivers, etc.).
- **Pieces**: Typed pieces owned by players, located on nodes/edges.
- **Cards**: Cards have icons and one or more verbs.
- **Verbs**: All game actions are triggered by playing a card. Turn = play one card, resolve its verbs, next player. No exceptions.

### Current Status
- Vanilla TS + Vite scaffolding
- Core types (`src/core/types.ts`)
- Deck utilities (`src/core/deck.ts`)
- Minimal engine enforcing the play-a-card flow and prompts (`src/core/engine.ts`)
- Minimal SVG UI (`src/ui/render.ts`)
- Sample state and cards (`src/sample/sampleData.ts`)

### Getting Started
```bash
npm install
npm run dev
```
Open the printed local URL. Click a hand card to play it. If a move prompt appears, click a highlighted piece, then click highlighted destination nodes to complete moves.

### Project Structure
```
src/
  core/
    types.ts      # map/pieces/cards/verbs/game state
    deck.ts       # draw/discard/shuffle/merge utilities
    engine.ts     # turn flow and prompt handling
  sample/
    sampleData.ts # tiny demo map, pieces, cards
  ui/
    render.ts     # minimal DOM+SVG renderer
  main.ts         # app wiring
```

### Design Goals
- Keep the engine separate from UI
- Deterministic, serializable state
- Explicit prompts for user input during verb execution
- Opinionated: every action comes from a card

### Next Steps
- Expand verb set (multi-step, costs using tucked icons)
- Tucking UI and icon display
- Map edge types influencing movement
- Save/Load state, seedable RNG
- Optional networking later

### License
MIT
