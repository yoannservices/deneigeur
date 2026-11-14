/* Monter et descendre (touche F), logique pure (aucun import de three). Véhicules génériques :
   { id, solid: { x, z, hw, hd, yaw }, phys: { yaw }, enter(), exit(), stowed?, doorZ? } ; le pick-up a en plus
   bed (Set), nearTailgate(x, z), loadBlower(b), unloadBlower(b) (rampe animée par Pickup.js).
   À pied : F monte dans le véhicule le plus proche à moins de 2,5 m de sa caisse ; debout derrière le plateau avec la fraise
   chargée, F la décharge. Assis : F fait descendre côté conducteur (gauche), sinon à droite, derrière, devant ;
   descendre de la fraise derrière le plateau la charge. On ne descend qu'en dessous de 3 m/s. */
import { collide } from '../world/solids.js';

export const REACH = 2.5, WALKER_R = 0.3;

// distance d'un point au rectangle orienté s (0 dedans), même repère que solids.js
export function distRect(x, z, s) {
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw), dx = x - s.x, dz = z - s.z;
  const lx = dx * c - dz * n, lz = dx * n + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - s.hw), Math.max(0, Math.abs(lz) - s.hd));
}

// repère local [gauche, avant] du rectangle s -> monde
const toWorld = (s, lx, lz) => { const c = Math.cos(s.yaw), n = Math.sin(s.yaw); return [s.x + lx * c + lz * n, s.z - lx * n + lz * c]; };

// point de descente : premier côté libre (gauche = +x local, où est le conducteur), sinon le point repoussé hors des obstacles
export function exitSpot(v, solids) {
  const s = v.solid, o = WALKER_R + 0.25, dz = v.doorZ ?? 0;
  const cand = [[s.hw + o, dz], [-s.hw - o, dz], [0, -s.hd - o], [0, s.hd + o]].map(([lx, lz]) => toWorld(s, lx, lz));
  for (const [x, z] of cand) { const [a, b] = collide(x, z, WALKER_R, solids); if (Math.hypot(a - x, b - z) < 0.05) return [x, z]; }
  return collide(cand[0][0], cand[0][1], WALKER_R, solids);
}

export class Seat {
  constructor() { this.current = 'walker'; this.vehicle = null; }

  /* walker : { position: { x, z }, yaw, solids } ; renvoie 'enter' | 'exit' | 'load' | 'unload' | null */
  tryToggle(walker, vehicles) {
    const p = walker.position, pickup = vehicles.find((v) => v.bed), v = this.vehicle;
    if (v) {
      if ((v.phys.speed ?? Math.abs(v.phys.v ?? 0)) > 3) return null; // on ne descend pas en roulant
      const load = v.id === 'blower' && pickup && pickup.nearTailgate(v.solid.x, v.solid.z) && pickup.loadBlower(v);
      v.exit();
      [p.x, p.z] = exitSpot(v, walker.solids || []); walker.yaw = v.phys.yaw;
      this.vehicle = null; this.current = 'walker';
      return load ? 'load' : 'exit';
    }
    // décharger seulement si le joueur est plus près du hayon que de la portière conducteur
    const ps = pickup?.solid, near = (lx, lz) => { const [x, z] = toWorld(ps, lx, lz); return Math.hypot(p.x - x, p.z - z); };
    if (pickup?.bed.has('blower') && pickup.nearTailgate(p.x, p.z) && near(0, -ps.hd - 0.5) < near(ps.hw + WALKER_R + 0.25, pickup.doorZ ?? 0)) {
      const b = vehicles.find((k) => k.id === 'blower');
      if (b && pickup.unloadBlower(b)) return 'unload';
    }
    let best = null, bd = REACH;
    for (const k of vehicles) { if (k.stowed) continue; const d = distRect(p.x, p.z, k.solid); if (d < bd) { bd = d; best = k; } }
    if (!best) return null;
    best.enter(); this.vehicle = best; this.current = best.id;
    return 'enter';
  }
}
