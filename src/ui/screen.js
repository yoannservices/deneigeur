/* Écrans du bloc #screen (cadre .hk-card de assets/game-menu.css, pied GameSettings.foot()) : titre et pause.
   Manette : gamepad.js parcourt les boutons de #screen (stick / croix = focus, A = clic, B = Échap). */
const root = document.getElementById('screen');
let openedAt = 0;

export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const btn = (label, fn, cls = '') => { const b = el('button', 'hk-btn ' + cls, label); b.type = 'button'; b.onclick = fn; return b; };
export const euro = (n) => `${Math.round(n).toLocaleString('fr-FR')} €`;
export const hhmm = (m) => `${Math.floor(m / 60)} h ${String(Math.floor(m % 60)).padStart(2, '0')}`;
// ms depuis l'ouverture du dernier écran : la touche Échap injectée par la perte du pointeur ne doit pas le refermer aussitôt
export const sinceOpen = () => performance.now() - openedAt;

export function show(card, foot = true) {
  if (foot) { const f = window.GameSettings?.foot(); if (f) card.append(f); }
  root.hidden = false; root.replaceChildren(card); openedAt = performance.now();
  (card.querySelector('.hk-primary:not(:disabled)') || card.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
}
export function hide() { root.hidden = true; root.replaceChildren(); }
export const card = (title, cls = '') => { const c = el('div', 'hk-card ' + cls); if (title) c.append(el('h2', null, title)); return c; };

// G : { S, hasSave, cont(), newGame() }
export function title(G) {
  const c = card(null, 'menu');
  const L = document.querySelector('script[data-name]')?.dataset || {};
  c.append(el('div', 'hk-brief', `<h1>${L.name || 'Déneigeur'}</h1><p>${L.description || ''}</p>`));
  if (G.hasSave) c.append(btn(`Continuer <small>nuit ${G.S.night} · ${euro(G.S.money)}</small>`, G.cont, 'hk-primary'));
  c.append(btn(G.hasSave ? 'Nouvelle partie <small>remplace la sauvegarde à la fin de la nuit 1</small>' : 'Nouvelle partie', G.newGame, G.hasSave ? '' : 'hk-primary'));
  show(c);
}

// G : { resume(), endNow(), quit() }
export function pause(G) {
  const c = card('Pause', 'menu');
  c.append(btn('Reprendre', G.resume, 'hk-primary'), btn('Terminer la nuit maintenant', G.endNow), btn('Menu principal <small>la nuit en cours est perdue</small>', G.quit));
  show(c);
}
