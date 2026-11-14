/* Carte du quartier (M) : rues, dépôt, zones des contrats acceptés (couleur selon la part propre), joueur.
   Un bouton par contrat choisit la zone vers laquelle guident GameSettings.arrow et GameSettings.ground. Le jeu est en pause. */
import { el, btn, card, show } from './screen.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const color = (p) => css(p >= 0.95 ? '--ui-ok' : p >= 0.7 ? '--ui-warn' : '--ui-danger');

// G : { layout, contracts, rects (id -> Rect), player: { x, z, yaw }, guide (contrat ou null), choose(k), close() }
export function mapView(G) {
  const L = G.layout, c = card('Carte du quartier', 'menu wide'), cv = el('canvas', 'map');
  const N = 600, s = N / L.size; cv.width = cv.height = N;
  const g = cv.getContext('2d'), X = (x) => x * s, Y = (z) => (L.size - z) * s; // nord en haut
  const rect = (r) => g.fillRect(X(r.x0), Y(r.z0 + r.d), r.w * s, r.d * s);
  g.fillStyle = css('--ui-surface-2'); g.fillRect(0, 0, N, N);
  g.fillStyle = css('--ui-border-strong'); L.roads.forEach(rect);
  // emprise des bâtiments : w le long de la façade, d en profondeur (yaw par quarts de tour)
  g.fillStyle = css('--ui-surface-3');
  for (const b of [...L.buildings, ...L.houses]) { const t = Math.abs(Math.sin(b.yaw)) > 0.5, w = t ? b.d : b.w, d = t ? b.w : b.d; g.fillRect(X(b.x - w / 2), Y(b.z + d / 2), w * s, d * s); }
  g.fillStyle = css('--ui-accent'); g.globalAlpha = 0.35; rect(L.depot); g.globalAlpha = 1;
  for (const k of G.contracts) {
    const rs = k.zoneIds.map((id) => G.rects.get(id)).filter(Boolean), p = k.result ? k.result.p : k.p || 0;
    g.fillStyle = color(p); rs.forEach(rect);
    if (k === G.guide) { g.strokeStyle = css('--ui-text'); g.lineWidth = 3; rs.forEach((r) => g.strokeRect(X(r.x0) - 3, Y(r.z0 + r.d) - 3, r.w * s + 6, r.d * s + 6)); }
  }
  const P = G.player; // flèche du joueur (cap : avant = (sin yaw, cos yaw))
  g.save(); g.translate(X(P.x), Y(P.z)); g.rotate(P.yaw + Math.PI);
  g.fillStyle = css('--ui-text'); g.beginPath(); g.moveTo(0, 12); g.lineTo(8, -8); g.lineTo(0, -3); g.lineTo(-8, -8); g.closePath(); g.fill(); g.restore();
  c.append(cv);
  const list = el('div', 'rows');
  for (const k of G.contracts) {
    const p = Math.round(100 * (k.result ? k.result.p : k.p || 0));
    list.append(btn(`<span><b>${k.name}</b><small>${p} % propre${k.result ? ' · heure limite passée' : ''}</small></span><em>${k === G.guide ? 'Guidage' : 'Guider'}</em>`, () => G.choose(k), 'row' + (k === G.guide ? ' on' : '')));
  }
  c.append(list, btn('Fermer (M)', G.close, 'hk-primary'));
  show(c, false);
}
