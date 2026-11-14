/* HUD de la nuit (#hud) : heure, endurance, charge, essence de la fraise, sel, contrat le plus proche (part propre, heure limite),
   pénalités de la nuit, message quand un jet est refusé faute d'endurance. Rafraîchi 10 fois par seconde au plus (écritures DOM). */
import { hhmm, euro } from './screen.js';

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.root.innerHTML = `<div class="panel hud-box">
      <div class="clock"><b data-k="clock"></b><small data-k="night"></small></div>
      <div class="bar" title="Endurance"><span>Endurance</span><i><u data-k="stam"></u></i></div>
      <div data-k="load"></div><div data-k="fuel"></div><div data-k="salt"></div>
      <div class="near" data-k="near"></div><div class="pen" data-k="pen"></div></div>
      <div class="toast" data-k="toast" hidden></div>`;
    this.k = Object.fromEntries([...this.root.querySelectorAll('[data-k]')].map((e) => [e.dataset.k, e]));
    this.t = 0;
  }
  show(on) { this.root.hidden = !on; }
  set(k, html) { const e = this.k[k]; if (e._v !== html) { e._v = html; e.innerHTML = html; e.hidden = !html; } }

  // s : { minutes, night, walker, seated (en véhicule : pas de ligne Charge), blower (null si pas possédée), tank, near: { k, d } | null, penalties }
  update(dt, s) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.1;
    const w = s.walker, st = w.stamina;
    this.set('clock', hhmm(s.minutes)); this.set('night', `nuit ${s.night}`);
    this.k.stam.style.width = `${(100 * st.v / st.max).toFixed(0)}%`; this.k.stam.classList.toggle('low', st.exhausted);
    this.set('load', !s.seated && w.carry.kg > 0.05 ? `Charge <b>${w.carry.kg.toFixed(1).replace('.', ',')} kg</b>` : '');
    this.set('fuel', s.blower ? `Fraise <b>${s.blower.fuel.toFixed(1).replace('.', ',')} / ${s.tank} L</b>` : '');
    this.set('salt', w.salt ? `Sel <b>${w.salt}</b> (X)` : '');
    const n = s.near;
    this.set('near', n ? `<b>${n.k.name}</b> ${Math.round(100 * (n.k.result ? n.k.result.p : n.k.p || 0))} % · avant ${hhmm(n.k.deadline)}${n.d > 3 ? ` · ${Math.round(n.d)} m` : ''}` : '');
    this.set('pen', s.penalties ? `Pénalités <b>-${euro(s.penalties)}</b>` : '');
    this.set('toast', w.refused > 0 ? 'Trop fatigué pour lancer : reprends ton souffle' : s.blower && s.blower.fuel <= 0 ? 'Fraise en panne d’essence : jerrican du pick-up (J)' : '');
  }
}
