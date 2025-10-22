import { draw, mergeDecks, shuffleDeck } from './deck';
import type { Card, Deck, GameState, PlayerId, VerbSpec, NodeId, PieceId } from './types';
import { currentPlayer, findAdjacentNodes, nextPlayerId } from './types';

export interface EngineConfig {
  handLimit: number;
}

export const DefaultConfig: EngineConfig = { handLimit: 5 };

export function startTurn(state: GameState): void {
  state.prompt = null;
  if (!state.currentPlayerId) {
    // Initialize using legacy index for hotseat
    state.currentPlayerId = state.players[state.currentPlayerIndex].id;
  }
}

export function endTurn(state: GameState): void {
  // Advance authoritative turn owner by seating
  state.currentPlayerId = nextPlayerId(state);
  // Keep legacy index in sync for hotseat
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === state.currentPlayerId);
  state.prompt = null;
}

export function playCard(state: GameState, cardId: string): void {
  if (state.gameOver) return;
  const player = currentPlayer(state);
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return;
  const [card] = player.hand.splice(idx, 1);
  state.log.push({ message: `${player.name} plays ${card.name}` });
  for (const verb of card.verbs) {
    if (state.gameOver) break;
    executeVerb(state, player.id, card, verb);
  }
  if (!state.gameOver) {
    endTurn(state);
  }
}

function executeVerb(
  state: GameState,
  playerId: PlayerId,
  card: Card,
  verb: VerbSpec,
): void {
  switch (verb.type) {
    case 'draw': {
      const player = state.players.find((p) => p.id === playerId)!;
      // If draw pile empty, reshuffle discard into draw
      if (player.drawPile.cards.length === 0 && player.discardPile.cards.length > 0) {
        player.drawPile = shuffleDeck(mergeDecks([player.discardPile]));
        player.discardPile = { cards: [] } as Deck;
      }
      const { drawn, deck } = draw(player.drawPile, verb.count);
      player.drawPile = deck;
      player.hand.push(...drawn);
      state.log.push({ message: `${player.name} draws ${drawn.length}` });
      break;
    }
    case 'tuckSelf': {
      const player = state.players.find((p) => p.id === playerId)!;
      player.tucked.push(card);
      state.log.push({ message: `${player.name} tucks ${card.name}` });
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
  const nextSteps = state.prompt.next.kind === 'forMove' ? state.prompt.next.steps : 0;
  const piece = state.pieces[pieceId];
  if (!piece || piece.location.kind !== 'node') return;
  const options = findAdjacentNodes(state.map, piece.location.nodeId);
  state.prompt = {
    kind: 'selectAdjacentNode',
    playerId: state.prompt.playerId,
    pieceId,
    nodeOptions: options,
    stepsRemaining: nextSteps,
    message: 'Select destination',
  };
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
  }
}


