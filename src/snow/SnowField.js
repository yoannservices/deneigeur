// Grille de neige (logique pure, aucun import de three). Masse conservée partout.
export const CELL = 0.1;
export const CLEAN = 0.01;
export const ICE_THIN = 0.02; // m : le verglas n'agit (glisse, adhérence, aspect) que sous moins de 2 cm de neige
export const CHUNK = 80;
export const DENS = { powder: 100, wet: 400, packedMin: 300, packedMax: 500 };
const C2 = CELL * CELL;

export class SnowField {
  // slope : pente linéaire du sol sous le champ (m par m) ; les hauteurs de neige h restent comptées depuis ce sol
  constructor({ id, x0, z0, w, d, y = 0, kind, slope = { dx: 0, dz: 0 } }) {
    this.id = id; this.x0 = x0; this.z0 = z0; this.w = w; this.d = d; this.y = y; this.kind = kind; this.slope = slope;
    this.nx = Math.ceil(w / CELL - 1e-6); this.nz = Math.ceil(d / CELL - 1e-6); // 0,3 / 0,1 = 3,0000000000000004 en flottant
    this.chunksX = Math.ceil(this.nx / CHUNK); this.chunksZ = Math.ceil(this.nz / CHUNK);
    const n = this.nx * this.nz;
    this.h = new Float32Array(n); this.rho = new Float32Array(n).fill(DENS.powder); this.ice = new Uint8Array(n);
    this.loose = new Float32Array(n); // part de h (m) fraîchement jetée : seule elle éboule ; la neige tassée tient une coupe verticale
    this.dirty = new Set(); this.active = new Set(); // active : cellules à relaxer (éboulement)
    // offEdge(x, z, kg) : neige meuble qui s'éboule au-delà du bord ; true si elle a quitté le champ (posé par Snow.add)
    this.offEdge = null;
  }
  baseY(x, z) { return this.y + this.slope.dx * (x - this.x0) + this.slope.dz * (z - this.z0); }
  chunkOf(i) { const iz = (i / this.nx) | 0, ix = i - iz * this.nx; return ((iz / CHUNK) | 0) * this.chunksX + ((ix / CHUNK) | 0); }
  // Marque les morceaux dont la texture (83 x 83 : 1 cellule de marge avant, 2 après) contient la cellule i.
  markCell(i) {
    const iz = (i / this.nx) | 0, ix = i - iz * this.nx, cx = (ix / CHUNK) | 0, cz = (iz / CHUNK) | 0, lx = ix - cx * CHUNK, lz = iz - cz * CHUNK;
    const x0 = lx <= 1 && cx > 0 ? cx - 1 : cx, x1 = lx === CHUNK - 1 && cx + 1 < this.chunksX ? cx + 1 : cx;
    const z0 = lz <= 1 && cz > 0 ? cz - 1 : cz, z1 = lz === CHUNK - 1 && cz + 1 < this.chunksZ ? cz + 1 : cz;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.dirty.add(z * this.chunksX + x);
  }
  markAll() { for (let c = this.chunksX * this.chunksZ - 1; c >= 0; c--) this.dirty.add(c); }
  fill(depth, rho) { this.h.fill(depth); this.loose.fill(0); this.rho.fill(rho); this.markAll(); }
  cellAt(x, z) {
    const ix = Math.floor((x - this.x0) / CELL), iz = Math.floor((z - this.z0) / CELL);
    return ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz ? -1 : iz * this.nx + ix;
  }
  mass() { let s = 0; const { h, rho } = this; for (let i = 0; i < h.length; i++) s += h[i] * rho[i]; return s * C2; }
  takeCell(i, maxKg) {
    const k = this.rho[i] * C2, m = this.h[i] * k;
    if (m <= 0 || maxKg <= 0) return 0;
    const t = Math.min(m, maxKg);
    const h0 = this.h[i]; this.h[i] = t >= m ? 0 : h0 - t / k;
    this.loose[i] = this.h[i] > 0 ? Math.min(this.h[i], Math.max(0, this.loose[i] - (h0 - this.h[i]))) : 0; // la neige meuble part en premier
    this.markCell(i); const a = this.active, nx = this.nx; a.add(i); a.add(i - 1); a.add(i + 1); a.add(i - nx); a.add(i + nx);
    return t;
  }
  addAt(x, z, kg, rho) {
    const i = this.cellAt(x, z); if (i < 0) return false;
    this.addCell(i, kg, rho); return true;
  }
  addCell(i, kg, rho) {
    if (kg <= 0) return;
    const m0 = this.h[i] * this.rho[i] * C2, dh = kg / (rho * C2), h1 = this.h[i] + dh;
    this.h[i] = h1; this.loose[i] += dh; this.rho[i] = (m0 + kg) / (h1 * C2); // tout ajout est meuble
    this.markCell(i); this.active.add(i);
  }
  // Éboulement : la neige coule vers les 4 voisines tant que la pente dépasse maxSlope (m/m). Masse conservée.
  // Au bord du champ : sans offEdge elle reste en place (mur) ; avec offEdge, la neige meuble trop raide par rapport au sol
  // d'à côté (hauteur 0) sort du champ (offEdge décide : tas au sol, ou mur si un autre champ touche ce bord).
  // Travail borné : au plus `budget` cellules actives par appel.
  relax(maxSlope = 0.9, budget = 3000) {
    const { h, rho, loose, nx, nz, active } = this, maxD = maxSlope * CELL, list = [];
    for (const k of active) { if (list.length >= budget) break; list.push(k); }
    for (const k of list) active.delete(k);
    for (const k of list) {
      if (k < 0 || k >= h.length) continue;
      const iz = (k / nx) | 0, ix = k - iz * nx; let moved = false;
      for (let n = 0; n < 4; n++) {
        const jx = ix + (n === 0) - (n === 1), jz = iz + (n === 2) - (n === 3);
        if (loose[k] <= 0) break;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) {
          if (!this.offEdge || h[k] <= maxD + 1e-4) continue;
          const q = Math.min(loose[k], (h[k] - maxD) * 0.4);
          if (!this.offEdge(this.x0 + (jx + 0.5) * CELL, this.z0 + (jz + 0.5) * CELL, q * rho[k] * C2)) continue;
          h[k] -= q; loose[k] -= q; if (h[k] < 1e-6) { h[k] = 0; loose[k] = 0; }
          moved = true; continue;
        }
        const m = jz * nx + jx, dt = h[k] - h[m];
        if (dt <= maxD + 1e-4) continue; // tolérance : sans elle la convergence est asymptotique
        const q = Math.min(loose[k], (dt - maxD) * 0.4), r = rho[k];
        h[k] -= q; loose[k] -= q; if (h[k] < 1e-6) { h[k] = 0; loose[k] = 0; }
        this.addCell(m, q * r * C2, r); // addCell active + marque m
        moved = true;
      }
      if (moved) { this.markCell(k); active.add(k); active.add(k - 1); active.add(k + 1); active.add(k - nx); active.add(k + nx); } // k a baissé : ses voisines peuvent devenir trop raides
    }
    return list.length;
  }
  // tol (m) : seuil « propre » ; la nuit y ajoute la neige tombée depuis le début (une zone dégagée tôt reste propre)
  cleanFraction(tol = CLEAN) { let c = 0; const h = this.h; for (let i = 0; i < h.length; i++) if (h[i] < tol) c++; return c / h.length; }
  // mark = false : seules les cellules qui passent un seuil visible (propre, verglas couvert) sont marquées (rattrapage avant évaluation)
  snow(dtGameHours, cmPerHour, rho, mark = true) {
    const dh = cmPerHour * 0.01 * dtGameHours; if (dh <= 0) return;
    const { h, rho: r, ice } = this, mk = dh * rho * C2;
    for (let i = 0; i < h.length; i++) {
      const h0 = h[i], m0 = h0 * r[i] * C2; h[i] += dh; r[i] = (m0 + mk) / (h[i] * C2);
      if (!mark && ((h0 < CLEAN && h[i] >= CLEAN) || (ice[i] && h0 < ICE_THIN && h[i] >= ICE_THIN))) this.markCell(i);
    }
    if (mark) this.markAll();
  }
  pack(i, amount) {
    const h = this.h[i]; if (h <= 0) return;
    const r = this.rho[i], r1 = Math.min(DENS.packedMax, r + (DENS.packedMax - r) * amount);
    if (r1 <= r) return;
    this.h[i] = h * r / r1; this.loose[i] = Math.min(this.loose[i], this.h[i]); this.rho[i] = r1; this.markCell(i);
  }
}

export class Snow {
  constructor() { this.fields = []; this.ground = []; }
  // la neige meuble qui s'éboule hors d'un champ va au sol (tas), sauf si un autre champ touche ce bord (marches, trottoirs voisins)
  add(field) {
    this.fields.push(field);
    field.offEdge = (x, z, kg) => { if (this.fieldAt(x, z)) return false; this.dropGround(x, z, kg); return true; };
  }
  fieldAt(x, z) { for (const f of this.fields) if (f.cellAt(x, z) >= 0) return f; return null; }
  // Points d'une trame de pas CELL ancrée en (x,z) dans le disque ; (x,z) toujours inclus.
  deposit(x, z, kg, rho, radius) {
    if (kg <= 0) return;
    const n = Math.max(0, Math.floor(radius / CELL)), r2 = radius * radius + 1e-9;
    let N = 0;
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) if ((a * a + b * b) * C2 <= r2) N++;
    const share = kg / N; let off = 0;
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
      if ((a * a + b * b) * C2 > r2) continue;
      const px = x + a * CELL, pz = z + b * CELL, f = this.fieldAt(px, pz);
      if (f) f.addAt(px, pz, share, rho); else off += share;
    }
    if (off > 0) this.dropGround(x, z, off);
  }
  dropGround(x, z, kg) {
    for (const g of this.ground) {
      if (Math.hypot(g.x - x, g.z - z) < 0.5) { // centre de masse
        const t = g.kg + kg; g.x = (g.x * g.kg + x * kg) / t; g.z = (g.z * g.kg + z * kg) / t; g.kg = t; return;
      }
    }
    this.ground.push({ x, z, kg });
  }
  total() { let s = 0; for (const f of this.fields) s += f.mass(); for (const g of this.ground) s += g.kg; return s; }
}
