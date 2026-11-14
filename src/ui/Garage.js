/* Garage du dépôt entre deux nuits (§9) : onglets Pelles, Équipement, Fraise, Quad, Entretien (plein à 2 €/L, sel, réparations).
   Chaque achat est sauvegardé tout de suite (G.persist). La luge n'est pas vendue tant qu'elle n'est pas branchée. */
import { el, btn, card, show, euro } from './screen.js';
import { CATALOG, buy, spend, fuelCost } from '../gameplay/economy.js';
import { blowerSpec } from '../vehicles/blowerLogic.js';

const C = CATALOG;
const SHOVEL_TXT = { base: ['Pelle de base', '50 cm, 8 kg'], large: ['Pelle large', '70 cm, 12 kg'], pusher: ['Pelle-poussoir', '90 cm, 25 kg, pousse seulement, pas de lancer'] };
const GEAR_TXT = { steel: ['Lame acier', 'casse le verglas'], gloves: ['Gants', 'endurance maximale +20'], boots: ['Bottes', 'marche dans la neige -25 %, moins de glissades'] };
const BLOWER_TXT = { motor: ['Moteur 9 ch', 'débit +50 %'], width: ['Largeur 71 cm', 'au lieu de 56 cm'], tank: ['Réservoir 4 L', 'au lieu de 2 L'], lights: ['Phare', 'éclaire devant la fraise (L)'], chute: ['Goulotte longue portée', '10 m au lieu de 6 m'] };
const QUAD_TXT = { vblade: ['Lame en V', 'déverse des deux côtés'], chains: ['Chaînes', 'adhérence sur neige tassée et verglas'], lights: ['Phare renforcé', 'visibilité'], spreader: ['Saleuse arrière', 'répand le sel en roulant'] };
export const VEHICLE_NAME = { pickup: 'pick-up', quad: 'quad' };
export const upgradesOf = (S, v) => Object.fromEntries(Object.keys(v === 'blower' ? C.BLOWER_UPGRADES : C.QUAD_UPGRADES).map((k) => [k, S.owned.includes(`${v}:${k}`)]));

// G : { S, persist(), next() }
export function garage(G, tab = 'pelles') {
  const S = G.S, c = card('Garage du dépôt', 'menu wide');
  // après un clic, l'écran est refait : le focus reste sur le même bouton (souris, clavier, manette)
  const keep = (go) => { const i = [...c.querySelectorAll('button')].indexOf(document.activeElement); go(); document.querySelectorAll('#screen button')[i]?.focus({ preventScroll: true }); };
  const act = (fn) => () => keep(() => { if (fn()) G.persist(); garage(G, tab); });
  c.append(el('p', 'lede', `Nuit ${S.night} à venir · <b>${euro(S.money)}</b> · réputation ${S.rep}`));
  const tabs = el('div', 'tabs');
  for (const [k, label] of [['pelles', 'Pelles'], ['equipement', 'Équipement'], ['fraise', 'Fraise'], ['quad', 'Quad'], ['entretien', 'Entretien']]) {
    const t = btn(label, () => keep(() => garage(G, k)), 'tab' + (k === tab ? ' on' : '')); tabs.append(t);
  }
  c.append(tabs);
  const list = el('div', 'rows');
  // un rang : titre, détail, bouton (ou état)
  const row = (title, sub, label, fn, ok = true) => {
    const r = el('div', 'item', `<span><b>${title}</b><small>${sub}</small></span>`);
    r.append(fn ? btn(label, act(fn)) : el('em', null, label));
    if (fn && !ok) r.lastChild.disabled = true;
    list.append(r);
  };
  const shop = (id, price, [title, sub]) => {
    if (S.owned.includes(id)) row(title, sub, 'Acheté');
    else row(title, sub, `Acheter ${euro(price)}`, () => buy(S, id, price), S.money >= price);
  };
  if (tab === 'pelles') for (const [k, s] of Object.entries(C.SHOVELS)) {
    const id = 'shovel:' + k, [title, sub] = SHOVEL_TXT[k];
    if (S.shovel === k) row(title, sub, 'En main');
    else if (S.owned.includes(id)) row(title, sub, 'Prendre', () => { S.shovel = k; return true; });
    else row(title, sub, `Acheter ${euro(s.price)}`, () => buy(S, id, s.price) && (S.shovel = k), S.money >= s.price);
  }
  if (tab === 'equipement') {
    for (const k of Object.keys(GEAR_TXT)) shop('gear:' + k, C.GEAR[k], GEAR_TXT[k]);
    row('Sac de sel', `20 m², fond le verglas en 2 min de jeu (X) · ${S.salt} en stock`, `Acheter ${euro(C.GEAR.salt)}`, () => spend(S, C.GEAR.salt) && ++S.salt, S.money >= C.GEAR.salt);
  }
  const vehicle = (id, price, title, sub, ups, txt) => {
    if (!S.owned.includes(id)) {
      row(title, sub, `Acheter ${euro(price)}`, () => buy(S, id, price) && (id !== 'blower' || (S.fuel.blower = blowerSpec().tank)), S.money >= price);
      list.append(el('p', 'hint', 'Ses améliorations seront proposées après l’achat.'));
    } else for (const k of Object.keys(ups)) shop(`${id}:${k}`, ups[k], txt[k]);
  };
  if (tab === 'fraise') vehicle('blower', C.blower, 'Fraise à neige', '6 ch, 56 cm, réservoir de 2 L (livrée pleine), contrats « fraise »', C.BLOWER_UPGRADES, BLOWER_TXT);
  if (tab === 'quad') vehicle('quad', C.quad, 'Quad avec lame', 'lame de 1,5 m, contrats « quad »', C.QUAD_UPGRADES, QUAD_TXT);
  if (tab === 'entretien') {
    if (S.owned.includes('blower')) {
      const tank = blowerSpec(upgradesOf(S, 'blower')).tank, cost = fuelCost(S.fuel.blower, tank);
      row('Plein de la fraise', `${S.fuel.blower.toFixed(1).replace('.', ',')} / ${tank} L · ${C.fuelPerL} €/L`, cost ? `Plein ${euro(cost)}` : 'Plein',
        cost ? () => spend(S, cost) && (S.fuel.blower = tank) : null, S.money >= cost);
    }
    for (const v of S.damaged) row(`Réparer le ${VEHICLE_NAME[v]}`, 'choc pendant la nuit · non réparé : vitesse de pointe -30 %', `Réparer ${euro(C.repair)}`,
      () => spend(S, C.repair) && S.damaged.splice(S.damaged.indexOf(v), 1), S.money >= C.repair);
    if (!list.children.length) list.append(el('p', 'hint', 'Rien à faire : aucun véhicule abîmé, pas de fraise à remplir.'));
  }
  c.append(list, btn('Tableau des contrats', G.next, 'hk-primary'));
  show(c);
}
