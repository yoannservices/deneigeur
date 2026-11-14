/* Fraise à neige (§8.2), logique pure (aucun import de three) : débit, calage, essence, jerrican.
   Débit maximal 25 kg/s à 6 ch, 37,5 kg/s à 9 ch. Avance réelle = min(voulue, débit / kg par mètre d'avance).
   Calage : demande > 1,5 × le possible pendant plus de 1 s ; calée, elle n'avance plus jusqu'au réembrayage
   (state.stalled = false, fait par SnowBlower sur Espace) mais recule. La marche arrière n'avale rien et ne cale pas.
   Essence : 0,1 L/h de jeu par ch (0,6 à 6 ch, 0,9 à 9 ch) ; state.fuel absent = réservoir non suivi, 0 = panne (décision G). */
import { CELL } from '../snow/SnowField.js';
import { distRect, REACH } from './seat.js';

export const BLOWER_UPGRADES = { motor: 250, width: 300, tank: 120, lights: 80, chute: 150 }; // prix (€), §8.2
export const GAME_H_PER_S = 1 / 300; // heures de jeu par seconde réelle (nuit : 5 s réelles par minute)
export const VMAX = 3 / 3.6;         // m/s, avant comme arrière
export const JERRYCAN = 2;           // L

export const blowerSpec = (u = {}) => ({ power: u.motor ? 9 : 6, width: u.width ? 0.71 : 0.56, tank: u.tank ? 4 : 2, range: u.chute ? 10 : 6 });

// gameH : heures de jeu par seconde réelle (horloge de la nuit, accélérable) ; GAME_H_PER_S par défaut
export function blowerStep(state, dt, { want, depthKgPerM, power, gameH = GAME_H_PER_S }) {
  if (state.fuel !== undefined) {
    if (state.fuel <= 0) return { speed: 0, stalled: !!state.stalled, kgPerSec: 0 };
    state.fuel = Math.max(0, state.fuel - 0.1 * power * dt * gameH);
  }
  if (state.stalled) return { speed: Math.min(0, want), stalled: true, kgPerSec: 0 };
  if (want <= 0) { state.overT = 0; return { speed: want, stalled: false, kgPerSec: 0 }; }
  const rate = 25 * power / 6, possible = depthKgPerM > 0 ? rate / depthKgPerM : Infinity;
  state.overT = want > 1.5 * possible ? (state.overT || 0) + dt : 0;
  if (state.overT > 1 + 1e-9) { state.stalled = true; return { speed: 0, stalled: true, kgPerSec: 0 }; }
  const speed = Math.min(want, possible);
  return { speed, stalled: false, kgPerSec: speed * depthKgPerM };
}

/* Régime moteur (tr/min) pour le tableau : 0 moteur coupé ou calé, 2000 au ralenti (turbine débrayée), 3000 turbine à vide,
   jusqu'à 3400 à plein débit, puis il s'écroule vers 1200 à mesure que la surcharge dure (overT de 0 à 1 s : calage). */
export function blowerRpm({ on, auger, stalled, overT = 0 }, kgPerSec, power) {
  if (!on || stalled) return 0;
  if (!auger) return 2000;
  const load = Math.min(1, kgPerSec / (25 * power / 6)), s = Math.min(1, overT);
  return (3000 + 400 * load) * (1 - s) + 1200 * s;
}

/* Pénalités d'un jet continu : la visée est tirée au hasard à chaque image, un bord de voiture est donc touché par intermittence.
   hit(kind, t) -> true seulement pour une nouvelle visée de cette cible (kind 'car' | 'door' | null) : plus de `cool` s sans la toucher. */
export class PenaltyGate {
  constructor(cool = 1) { this.cool = cool; this.last = {}; }
  hit(kind, t) {
    if (!kind) return false;
    const fresh = !(t - (this.last[kind] ?? -Infinity) <= this.cool);
    this.last[kind] = t;
    return fresh;
  }
}

// kg de neige par mètre d'avance sur la largeur w, mesurés sur `len` m devant le point (x, z) (cap yaw). Même balayage que pushBlade.
export function kgAhead(snow, x, z, yaw, w, len) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw), hw = w / 2;
  const ex = Math.abs(lx) * hw + Math.abs(fx) * len, ez = Math.abs(lz) * hw + Math.abs(fz) * len;
  let kg = 0;
  for (const f of snow.fields) {
    const ix0 = Math.max(0, Math.floor((x - ex - f.x0) / CELL)), ix1 = Math.min(f.nx - 1, Math.floor((x + ex - f.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((z - ez - f.z0) / CELL)), iz1 = Math.min(f.nz - 1, Math.floor((z + ez - f.z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const cx = f.x0 + (ix + 0.5) * CELL, cz = f.z0 + (iz + 0.5) * CELL, dx = cx - x, dz = cz - z;
      const u = dx * lx + dz * lz, v = dx * fx + dz * fz;
      if (u < -hw || u > hw || v < 0 || v > len || snow.fieldAt(cx, cz) !== f) continue;
      const i = iz * f.nx + ix; kg += f.h[i] * f.rho[i] * CELL * CELL;
    }
  }
  return kg / len;
}

/* Jerrican du plateau (touche J) : le joueur doit être à portée (2,5 m) de la fraise et du pick-up. +2 L sans dépasser
   le réservoir ; refusé si le réservoir est déjà plein. Le jerrican quitte le plateau. */
export function refuel(blower, pickup, p) {
  const tank = blowerSpec(blower.upgrades).tank;
  if (!pickup?.bed.has('jerrycan') || blower.fuel >= tank - 1e-6) return false;
  if (distRect(p.x, p.z, blower.solid) > REACH || distRect(p.x, p.z, pickup.solid) > REACH) return false;
  blower.fuel = Math.min(tank, blower.fuel + JERRYCAN); pickup.bed.delete('jerrycan');
  return true;
}
