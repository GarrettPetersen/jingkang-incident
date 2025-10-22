import type { Card, Deck } from './types';

export function cloneDeck(deck: Deck): Deck {
  return { cards: [...deck.cards] };
}

export function shuffleDeck(deck: Deck, rng: () => number = Math.random): Deck {
  const arr = [...deck.cards];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return { cards: arr };
}

export function draw(deck: Deck, n: number): { drawn: Card[]; deck: Deck } {
  const arr = [...deck.cards];
  const drawn = arr.splice(0, n);
  return { drawn, deck: { cards: arr } };
}

export function pushTop(deck: Deck, cards: Card[]): Deck {
  return { cards: [...cards, ...deck.cards] };
}

export function pushBottom(deck: Deck, cards: Card[]): Deck {
  return { cards: [...deck.cards, ...cards] };
}

export function mergeDecks(decks: Deck[]): Deck {
  return { cards: decks.flatMap((d) => d.cards) };
}


