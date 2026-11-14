// Lame, jet et glace (logique pure). Axes : avant = (sin yaw, cos yaw) ; droite du conducteur = (-cos yaw, sin yaw) (-x à yaw 0).
// `side` = +1 déverse à droite, -1 à gauche, 0 aux deux bouts. `spillMax` (facultatif, kg) borne le débord de cet appel :
// le reste de la charge dépasse alors `capacity` (lame du quad : débit limité au bout de la lame). `beyond` (facultatif, m,
// 0,3 par défaut) : distance du débord au-delà du bout de la lame. `sweepLoose` (facultatif, m) : au-delà du bout qui déverse,
// sur cette largeur, la lame roule aussi la neige meuble (le bourrelet de la passe précédente), sans toucher la neige en place.
import { CELL } from './SnowField.js';

const DEPTH = 0.15, BEYOND = 0.3, SPILL_R = 0.2;

// Verglas : toute lame prend la neige posée dessus ; seule la lame acier arrache la glace (sinon le sel).
export function scoopIce(field, i, steel) {
  if (field.ice[i] && steel) { field.ice[i] = 0; field.markCell(i); }
}

export function pushBlade(snow, blade, load) {
  const out = { taken: 0, spilled: 0 };
  if (!blade.down) return out;
  const { x, z, yaw, width, side, capacity } = blade, steel = !!blade.steel;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw), hw = width / 2;
  const sw = side ? Math.max(0, blade.sweepLoose || 0) : 0, ext = hw + sw; // côté du débord : u du signe de -side
  const ex = Math.abs(lx) * ext + Math.abs(fx) * DEPTH, ez = Math.abs(lz) * ext + Math.abs(fz) * DEPTH;
  let vol = load.kg > 0 ? load.kg / load.rho : 0, kg = load.kg;
  for (const f of snow.fields) {
    const ix0 = Math.max(0, Math.floor((x - ex - f.x0) / CELL)), ix1 = Math.min(f.nx - 1, Math.floor((x + ex - f.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((z - ez - f.z0) / CELL)), iz1 = Math.min(f.nz - 1, Math.floor((z + ez - f.z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const cx = f.x0 + (ix + 0.5) * CELL, cz = f.z0 + (iz + 0.5) * CELL, dx = cx - x, dz = cz - z;
      const u = dx * lx + dz * lz, v = dx * fx + dz * fz;
      if (v < 0 || v > DEPTH) continue;
      const out1 = u < -hw || u > hw; // hors de la lame : seulement la bande sweepLoose du côté du débord
      if (out1 && !(sw > 0 && -side * u > hw && -side * u <= ext)) continue;
      if (snow.fieldAt(cx, cz) !== f) continue; // zone superposée : la 1re la possède
      const i = iz * f.nx + ix;
      if (out1 ? f.loose[i] <= 0 : (scoopIce(f, i, steel), f.h[i] <= 0)) continue;
      const r = f.rho[i], t = f.takeCell(i, out1 ? f.loose[i] * r * CELL * CELL : Infinity);
      kg += t; vol += t / r; out.taken += t;
    }
  }
  if (out.taken > 0) load.rho = kg / vol;
  if (kg > capacity) {
    const extra = Math.min(kg - capacity, blade.spillMax ?? Infinity); kg -= extra; out.spilled = extra;
    const ends = side === 0 ? [-1, 1] : [side], k = extra / ends.length, d = hw + (blade.beyond ?? BEYOND);
    for (const s of ends) snow.deposit(x - lx * s * d, z - lz * s * d, k, load.rho, SPILL_R); // +1 = droite du conducteur
  }
  load.kg = kg;
  return out;
}

export function throwLoad(snow, load, x, z, spread = 0.25) {
  if (load.kg <= 0) return;
  snow.deposit(x, z, load.kg, load.rho, spread);
  load.kg = 0;
}
