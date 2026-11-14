/* Bilan de fin de nuit : un rang par contrat (part propre, étoiles, pénalités, paye), total, argent et réputation. */
import { el, btn, card, show, euro } from './screen.js';

// G : { S, garage() } ; info : { night, repBefore, damaged: ['pick-up', ...] }
export function report(G, r, info) {
  const c = card(`Bilan de la nuit ${info.night}`, 'menu wide');
  const t = el('table', 'report');
  t.innerHTML = '<thead><tr><th>Contrat</th><th>Propre</th><th>Étoiles</th><th>Pénalités</th><th>Paye</th></tr></thead>';
  const body = el('tbody');
  for (const row of r.rows) body.append(el('tr', row.p < 0.7 ? 'fail' : '',
    `<td>${row.name}</td><td>${Math.round(row.p * 100)} %</td><td>${'★'.repeat(row.stars)}${'☆'.repeat(3 - row.stars)}</td><td>${row.penalties ? '-' + euro(row.penalties) : '—'}</td><td>${euro(row.pay)}</td>`));
  t.append(body); c.append(t);
  const d = r.rep - info.repBefore;
  c.append(el('p', 'lede', `Total <b>${euro(r.total)}</b> · argent <b>${euro(G.S.money)}</b> · réputation <b>${r.rep}</b> (${d >= 0 ? '+' : ''}${d})`));
  if (info.damaged.length) c.append(el('p', 'hint', `Choc pendant la nuit : ${info.damaged.join(', ')}. Réparation au garage.`));
  c.append(el('p', 'hint', G.saved ? 'Partie sauvegardée.' : 'Sauvegarde indisponible : la partie ne sera pas gardée.'));
  c.append(btn('Garage', G.garage, 'hk-primary'));
  show(c);
}
