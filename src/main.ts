import './style.css'
import { initialState } from './sample/sampleData'
import { renderApp } from './ui/render'
import { inputSelectAdjacentNode, inputSelectPiece, playCard, startTurn } from './core/engine'

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
      inputSelectAdjacentNode(state, nodeId)
      rerender()
    },
  })
}

// Provide a global hook for SVG piece selection
;(window as any).onSelectPiece = (pieceId: string) => {
  inputSelectPiece(state, pieceId)
  rerender()
}

rerender()
