import './style.css'
import { initialState } from './sample/sampleData'
import { renderApp } from './ui/render'
import { endTurn, getTurnStartSnapshot } from './core/engine'
import { inputSelectAdjacentNode, inputSelectNode, inputSelectPiece, playCard, startTurn } from './core/engine'

const state = initialState
startTurn(state)

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

rerender()
