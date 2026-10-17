export type Suit = 's' | 'h' | 'd' | 'c';
export interface Card {
  r: number; // 2..14
  s: Suit;
}

export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
export const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function rankLabel(r: number): string {
  if (r <= 10) return String(r);
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r];
}

export const cardKey = (c: Card) => rankLabel(c.r) + c.s;
export const isRed = (c: Card) => c.s === 'h' || c.s === 'd';

export function makeDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s });
  return d;
}

/** mulberry32 seeded RNG */
export class RNG {
  private state: number;
  constructor(seed = Date.now()) {
    this.state = seed >>> 0;
  }
  setSeed(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
}

export function shuffle<T>(arr: T[], rng: RNG): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
