// Horloge de la nuit : minutes de jeu depuis minuit.
export class NightClock {
  constructor(start = 4 * 60, end = 7 * 60, realSecPerMin = 5) {
    this.start = start; this.end = end; this.k = realSecPerMin; this.minutes = start; this.fired = new Set();
  }
  update(dtReal) { this.minutes = Math.min(this.end, this.minutes + dtReal / this.k); }
  label() { const m = Math.floor(this.minutes); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }
  get done() { return this.minutes >= this.end; }
  at(m) { if (this.minutes < m || this.fired.has(m)) return false; this.fired.add(m); return true; }
}
