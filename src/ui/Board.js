/* Tableau des contrats avant la nuit (§7), avec le bulletin météo. Le joueur coche les contrats qu'il accepte (au moins un). */
import { el, btn, card, show, euro, hhmm } from './screen.js';

const TOOL = { pelle: 'pelle', fraise: 'fraise', quad: 'quad' };

// G : { S, start(accepted), garage() }
export function board(G, weather, contracts) {
  const w = weather, c = card(`Nuit ${G.S.night} · tableau des contrats`, 'menu wide');
  c.append(el('p', 'lede', `${euro(G.S.money)} · réputation ${G.S.rep}`));
  c.append(el('div', 'bulletin', `<b>Bulletin</b> ${w.startCm} cm au sol à 4 h 00, +${w.cmPerHour} cm/h · ${String(w.tempC).replace('.', ',')} °C · `
    + (w.wet ? 'neige mouillée, lourde : moins de contrats, payés +25 %' : 'poudreuse')
    + (w.tempC >= -1 && w.tempC <= 1 ? ' · verglas possible sous la neige tassée' : '')
    + (w.early ? ' · un habitant pressé avancera son heure limite de 30 min' : '')));
  const picked = new Set(), go = btn('Commencer la nuit', () => G.start(contracts.filter((k) => picked.has(k))), 'hk-primary');
  const list = el('div', 'rows');
  for (const k of contracts) {
    const b = btn(`<span><b>${k.name}</b><small>${TOOL[k.tool]} · avant ${hhmm(k.deadline)}</small></span><em>${euro(k.base)}</em>`, () => {
      if (picked.has(k)) picked.delete(k); else picked.add(k);
      b.classList.toggle('on', picked.has(k)); b.setAttribute('aria-pressed', picked.has(k)); go.disabled = !picked.size;
    }, 'row');
    b.setAttribute('aria-pressed', 'false'); list.append(b);
  }
  go.disabled = true;
  c.append(list, el('p', 'hint', 'Un contrat accepté et tenu sous 70 % coûte 2 points de réputation.'), go, btn('Garage', G.garage));
  show(c);
}
