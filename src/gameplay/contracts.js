// Tirage et évaluation des contrats (logique pure).
import { pay, stars } from './rules.js';

export function drawContracts(zones, { rep = 0, tools = ['pelle'], weather = {} } = {}, rand) {
  const wet = !!weather.wet;
  // zones d'un même groupe (les 20 marches de l'escalier) = un seul contrat, réglé par la première
  const groups = new Map();
  for (const z of zones) { const k = z.group ?? z.id; if (groups.has(k)) groups.get(k).ids.push(z.id); else groups.set(k, { ...z, ids: [z.id] }); }
  const pool = [...groups.values()].filter((z) => tools.includes(z.tool) && (z.base >= 90 ? rep >= 10 : true));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const n = Math.min(pool.length, 5 + Math.floor(rand() * 4) - (wet ? 1 : 0)); // 5 à 8, moins 1 si neige mouillée
  return pool.slice(0, n).map((z) => ({
    id: 'c-' + (z.group ?? z.id), zoneIds: z.ids, name: z.name ?? z.id, deadline: z.deadline,
    base: Math.round(z.base * (wet ? 1.25 : 1)), tool: z.tool,
  }));
}

// finishedAt (minutes de jeu) : renseigné par la nuit quand le contrat est fini.
// tol : seuil « propre » en m (cleanFraction), CLEAN par défaut.
export function evaluate(contract, snow, clock, penalties, tol) {
  let w = 0, c = 0;
  for (const f of snow.fields) if (contract.zoneIds.includes(f.id)) { const n = f.nx * f.nz; w += n; c += f.cleanFraction(tol) * n; }
  const p = w ? c / w : 0;
  const early = contract.finishedAt != null && contract.finishedAt <= contract.deadline - 30;
  return { p, pay: pay(contract.base, p, early, penalties), stars: stars(p, penalties) };
}
