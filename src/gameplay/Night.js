/* Déroulé d'une nuit (§4 à §7), logique pure (aucun import de three) : horloge, neige qui tombe, chasse-neige de la commune
   à 5 h 30, piétons à 6 h 00, bus à 6 h 50, habitant pressé (une nuit sur trois), verglas, sel, suivi des contrats,
   pénalités par contrat, fin de nuit et réputation.
   hooks (visuels de life.js) : onPlow(path), onPeds(peds), onBus(path), onEnd(report). peds = objets vivants
   { path, x, z, yaw, ... } déplacés ici (ils tassent la neige), life.js ne fait que les dessiner.
   Report = { rows: { name, p, stars, pay, penalties (€) }[], total, rep, weather }. */
import { NightClock } from './clock.js';
import { evaluate } from './contracts.js';
import { PENALTY } from './rules.js';
import { CELL, CLEAN } from '../snow/SnowField.js';

export const DONE = 0.95;                       // contrat fini : finishedAt (bonus si 30 min avant l'heure limite) et fin anticipée
export const PLOW = { kgPerM: 40, rho: 300, at: 330 }; // bourrelet de la commune : 40 kg par mètre de largeur d'allée
export const PEDS_AT = 360, BUS_AT = 410;
export const SALT = { r: Math.sqrt(20 / Math.PI), minutes: 2 }; // sac : disque de 20 m², fond le verglas en 2 minutes de jeu
const SNOW_STEP = 0.2;                          // cm : un champ ne reçoit la chute qu'une fois ce cumul atteint (peu de morceaux à renvoyer)

// Verglas au début de la nuit : entre -1 et 1 °C, la neige tassée (>= 400 kg/m³) restée de la veille gèle. Renvoie le nombre de cellules.
export function iceOver(snow, tempC) {
  if (tempC < -1 || tempC > 1) return 0;
  let n = 0;
  for (const f of snow.fields) {
    const { h, rho, ice } = f, n0 = n;
    for (let i = 0; i < h.length; i++) if (!ice[i] && h[i] > 0 && rho[i] >= 400) { ice[i] = 1; n++; }
    if (n > n0) f.markAll();
  }
  return n;
}

// Réputation après la nuit : + somme des étoiles - 2 par contrat accepté sous 70 %, jamais sous 0.
export const newRep = (rep, rows) => Math.max(0, rep + rows.reduce((s, r) => s + r.stars - (r.p < 0.70 ? 2 : 0), 0));

const inRect = (x, z, r) => x >= r.x0 && x < r.x0 + r.w && z >= r.z0 && z < r.z0 + r.d;
// axe long d'un rectangle (trottoir) : [[x, z], [x, z]]
const axis = (r) => (r.w >= r.d ? [[r.x0, r.z0 + r.d / 2], [r.x0 + r.w, r.z0 + r.d / 2]] : [[r.x0 + r.w / 2, r.z0], [r.x0 + r.w / 2, r.z0 + r.d]]);

export class Night {
  constructor({ snow, layout, hooks = {}, rand = Math.random }) {
    this.snow = snow; this.layout = layout; this.hooks = hooks; this.rand = rand;
    this.rep = 0; this.clock = new NightClock(); this.contracts = []; this.weather = null; this.report = null;
    this.peds = null; this.salts = [];
  }
  get realSecPerMin() { return this.clock.k; }
  set realSecPerMin(k) { this.clock.k = k; }
  get minutes() { return this.clock.minutes; }
  // seuil « propre » (m) : CLEAN + neige tombée depuis begin(), sinon une zone dégagée tôt ne compterait plus à l'heure limite
  tol() { return CLEAN + (this.weather?.cmPerHour > 0 ? this.weather.cmPerHour / 100 * (this.clock.minutes - this.clock.start) / 60 : 0); }

  begin(contracts, weather) {
    const L = this.layout;
    this.contracts = contracts; this.weather = weather; this.report = null; this.urgent = null;
    this.clock = new NightClock(4 * 60, 7 * 60, this.clock.k);
    for (const k of contracts) { k.pen = 0; k.p = 0; k.finishedAt = null; k.result = null; }
    this.byId = new Map(this.snow.fields.map((f) => [f.id, f]));
    this.rects = new Map((L.zones || []).map((z) => [z.id, z.rect]));
    // la neige tassée de la veille gèle, puis la neige du bulletin la recouvre (le verglas reste dessous)
    iceOver(this.snow, weather.tempC);
    for (const f of this.snow.fields) f.fill(weather.startCm / 100, weather.rho);
    this.snow.ground.length = 0;
    if (weather.early && contracts.length) { // un habitant sort sa voiture plus tôt : de préférence une allée
      const drives = contracts.filter((k) => k.zoneIds[0].startsWith('allee-')), pool = drives.length ? drives : contracts;
      this.urgent = pool[Math.floor(this.rand() * pool.length)]; this.urgent.deadline -= 30;
    }
    this.peds = null; this.salts = []; this.fallAt = new Map(); this.unmarked = new Map(); this.rr = 0; this.checked = this.clock.minutes; this.wasAt = false;
  }

  // player : { x, z } (fin anticipée au dépôt) ; renvoie le bilan quand la nuit finit
  update(dtReal, player) {
    if (this.report || !this.weather) return this.report;
    const c = this.clock, L = this.layout;
    c.update(dtReal);
    if (c.at(PLOW.at)) this.municipalPass();
    if (c.at(PEDS_AT)) this.spawnPeds();
    if (c.at(BUS_AT)) this.hooks.onBus?.(this.busPath());
    if (this.peds) this.walkPeds(dtReal);
    this.fall(); this.melt();
    const atDepot = !!player && !!L.depot && inRect(player.x, player.z, L.depot);
    if (c.minutes - this.checked >= 1 || (atDepot && (!this.wasAt || c.minutes - this.checked >= 0.2))) this.progress();
    this.wasAt = atDepot;
    const allDone = this.contracts.length > 0 && this.contracts.every((k) => (k.result ? k.result.p : k.p) >= DONE);
    if (c.done || (atDepot && allDone)) return this.end();
    return null;
  }

  // suivi des contrats : finishedAt au premier passage à 95 %, résultat figé à l'heure limite
  progress() {
    const m = this.clock.minutes; this.checked = m;
    for (const k of this.contracts) {
      if (k.result) continue;
      this.flush(k);
      k.p = evaluate(k, this.snow, this.clock, k.pen, this.tol()).p;
      if (k.p >= DONE && k.finishedAt == null) k.finishedAt = m;
      if (m >= k.deadline) k.result = evaluate(k, this.snow, this.clock, k.pen, this.tol());
    }
  }

  end() {
    if (this.report) return this.report;
    const rows = this.contracts.map((k) => {
      if (!k.result) { this.flush(k); k.result = evaluate(k, this.snow, this.clock, k.pen, this.tol()); }
      const r = k.result; return { name: k.name, p: r.p, stars: r.stars, pay: r.pay, penalties: k.pen };
    });
    this.rep = newRep(this.rep, rows);
    this.report = { rows, total: rows.reduce((s, r) => s + r.pay, 0), rep: this.rep, weather: this.weather };
    this.hooks.onEnd?.(this.report);
    return this.report;
  }

  // pénalité (car, door) au contrat non figé le plus proche du point (x, z) : là où se trouve le joueur
  penalize(kind, x, z) {
    let best = null, bd = Infinity;
    for (const k of this.contracts) {
      if (k.result) continue;
      for (const id of k.zoneIds) {
        const r = this.rects?.get(id); if (!r) continue;
        const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x0 - r.w), Math.max(r.z0 - z, 0, z - r.z0 - r.d));
        if (d < bd) { bd = d; best = k; }
      }
    }
    if (best) best.pen += PENALTY[kind] ?? 0;
    return best;
  }

  // 5 h 30 : bourrelet de la commune en travers de l'entrée (drive.mouth) de chaque allée, même déjà dégagée.
  // shortcut: le bourrelet apparaît d'un coup à 5 h 30 (pas au passage du camion) ; à lier à la position du camion si ça se voit
  municipalPass() {
    for (const h of this.layout.houses) {
      const m = h.drive.mouth, f = this.byId?.get(h.zone) ?? this.snow.fields.find((q) => q.id === h.zone);
      const nx = Math.round(m.w / CELL), nz = Math.round(m.d / CELL), kg = PLOW.kgPerM * m.w / (nx * nz);
      for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
        const x = m.x0 + (ix + 0.5) * CELL, z = m.z0 + (iz + 0.5) * CELL, i = f ? f.cellAt(x, z) : -1;
        if (i >= 0) f.addCell(i, kg, PLOW.rho); else this.snow.dropGround(x, z, kg);
      }
    }
    this.hooks.onPlow?.(this.plowPath());
  }
  // tournée du camion : descend la rue principale (voie ouest), aller-retour dans chaque rue (on roule à droite), sort au sud
  plowPath() {
    const [main, ...streets] = this.layout.roads; if (!main) return [];
    const mx = main.x0 + main.w * 0.3, path = [[mx, main.z0 + main.d]];
    for (const s of [...streets].sort((a, b) => b.z0 - a.z0)) {
      const zw = s.z0 + s.d * 0.7, ze = s.z0 + s.d * 0.3;
      path.push([mx, zw], [s.x0 + 3, zw], [s.x0 + 3, ze], [mx, ze]);
    }
    path.push([mx, main.z0 - 30]);
    return path;
  }
  busPath() { const m = this.layout.roads[0]; if (!m) return []; const x = m.x0 + m.w * 0.72; return [[x, m.z0 - 40], [x, m.z0 + m.d - 6]]; }

  // 6 h 00 : un piéton par trottoir (deux au-delà de 40 m), en allers-retours
  spawnPeds() {
    const L = this.layout, rects = [...(L.sidewalks || []), ...(L.zones || []).filter((z) => z.kind === 'sidewalk').map((z) => z.rect)];
    this.peds = [];
    rects.forEach((r, k) => {
      const path = axis(r), len = Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1]), n = len > 40 ? 2 : 1;
      for (let j = 0; j < n; j++) this.peds.push({ path, len, s: len * (j + this.rand()) / n, dir: (k + j) % 2 ? 1 : -1, speed: 1.1 + 0.3 * this.rand(), x: 0, z: 0, yaw: 0, cell: -1, field: null });
    });
    this.walkPeds(0);
    this.hooks.onPeds?.(this.peds);
  }
  // marche en temps réel ; chaque nouvelle cellule sous les pieds (bande de 0,3 m) est tassée
  walkPeds(dt) {
    for (const p of this.peds) {
      p.s += p.dir * p.speed * dt;
      if (p.s > p.len) { p.s = p.len; p.dir = -1; } else if (p.s < 0) { p.s = 0; p.dir = 1; }
      const [a, b] = p.path, t = p.s / p.len, ux = (b[0] - a[0]) / p.len, uz = (b[1] - a[1]) / p.len;
      p.x = a[0] + (b[0] - a[0]) * t; p.z = a[1] + (b[1] - a[1]) * t; p.yaw = Math.atan2(ux * p.dir, uz * p.dir);
      const f = this.snow.fieldAt(p.x, p.z), i = f ? f.cellAt(p.x, p.z) : -1;
      if (i === p.cell && f === p.field) continue;
      p.cell = i; p.field = f;
      for (const o of [-0.1, 0, 0.1]) {
        const x = p.x + uz * o, z = p.z - ux * o, g = this.snow.fieldAt(x, z);
        if (g) g.pack(g.cellAt(x, z), 0.25);
      }
    }
  }

  // neige qui tombe : un champ par appel (tour à tour), seulement quand son cumul atteint SNOW_STEP cm
  fall() {
    const w = this.weather, fs = this.snow.fields;
    if (!fs.length || !(w.cmPerHour > 0)) return;
    this.fallOn(fs[this.rr++ % fs.length], false);
  }
  fallOn(f, force) {
    // unmarked : cm tombés depuis le dernier markAll du champ ; le rattrapage (force) met les hauteurs à jour sans le remettre à 0,
    // le chemin, quel qu'il soit, qui le porte à SNOW_STEP marque tout le champ (sinon la neige qui s'épaissit ne se verrait pas)
    const w = this.weather, m = this.clock.minutes, dh = (m - (this.fallAt.get(f) ?? this.clock.start)) / 60;
    if (dh <= 0 || !(w.cmPerHour > 0)) return;
    const acc = (this.unmarked.get(f) ?? 0) + dh * w.cmPerHour, mark = acc >= SNOW_STEP - 1e-9; // tolérance : 6 x (2 cm / 60) en flottant
    if (!force && !mark) return;
    f.snow(dh, w.cmPerHour, w.rho, mark); this.fallAt.set(f, m); this.unmarked.set(f, mark ? 0 : acc);
  }
  flush(k) { for (const id of k.zoneIds) { const f = this.byId?.get(id); if (f) this.fallOn(f, true); } }

  // sel (X, ou saleuse du quad) : le verglas du disque fond 2 minutes de jeu plus tard
  salt(x, z, r = SALT.r) { this.salts.push({ x, z, r, t: this.clock.minutes + SALT.minutes }); }
  melt() {
    if (!this.salts.length) return;
    const m = this.clock.minutes;
    this.salts = this.salts.filter((s) => {
      if (m < s.t) return true;
      for (const f of this.snow.fields) {
        const ix0 = Math.max(0, Math.floor((s.x - s.r - f.x0) / CELL)), ix1 = Math.min(f.nx - 1, Math.floor((s.x + s.r - f.x0) / CELL));
        const iz0 = Math.max(0, Math.floor((s.z - s.r - f.z0) / CELL)), iz1 = Math.min(f.nz - 1, Math.floor((s.z + s.r - f.z0) / CELL));
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
          const i = iz * f.nx + ix;
          if (f.ice[i] && Math.hypot(f.x0 + (ix + 0.5) * CELL - s.x, f.z0 + (iz + 0.5) * CELL - s.z) <= s.r) { f.ice[i] = 0; f.markCell(i); }
        }
      }
      return false;
    });
  }
}
