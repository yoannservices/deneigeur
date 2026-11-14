// Règles de paie, étoiles, charge et endurance (logique pure).
import { clamp } from '../core/util.js';

export const PENALTY = { car: 10, door: 5 };
export const pay = (base, p, early, penalties) =>
  Math.max(0, Math.round(base * clamp((p - 0.70) / 0.25, 0, 1) * (early ? 1.2 : 1) - penalties));
export const stars = (p, penalties) => (p >= 0.98 && penalties === 0 ? 3 : p >= 0.90 ? 2 : p >= 0.70 ? 1 : 0);
export const walkFactor = (load, capacity) => 1 - 0.6 * load / capacity;

export class Stamina {
  constructor() { this.max = 100; this.v = 100; this.exhausted = false; }
  throwCost(kg) { return 0.5 * kg; }
  update(dt, state) {
    const rate = state === 'idle' ? 8 : state === 'walk' ? 3 : -1; // /s
    this.v = clamp(this.v + rate * dt, 0, this.max);
    if (this.v <= 0) this.exhausted = true; else if (this.exhausted && this.v >= 30) this.exhausted = false;
  }
  spend(n) {
    if (this.exhausted || this.v < n) return false;
    this.v -= n; if (this.v <= 0) { this.v = 0; this.exhausted = true; }
    return true;
  }
}
