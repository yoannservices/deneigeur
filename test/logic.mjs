// Logique pure (aucun import de three) : node test/logic.mjs
import assert from 'node:assert/strict';
import { clamp } from '../src/core/util.js';
import { SnowField, Snow, DENS, CLEAN } from '../src/snow/SnowField.js';
import { pay, stars, walkFactor, Stamina } from '../src/gameplay/rules.js';
import { NightClock } from '../src/gameplay/clock.js';
import { drawContracts, evaluate } from '../src/gameplay/contracts.js';
import { rng } from '../src/core/util.js';
import { pushBlade, throwLoad, scoopIce } from '../src/snow/blade.js';
import { SHOVELS, GEAR, EFFECTS } from '../src/player/toolsData.js';
import { pushOut, collide, solidsFrom, overlaps, freeSpot } from '../src/world/solids.js';
import { snowDrag, CarPhysics, collideCar, MU } from '../src/vehicles/physics.js';
import { Seat, distRect } from '../src/vehicles/seat.js';
import { quadrantOf, QUAD_UPGRADES, BLADE, quadGrip, spillPerM, spillSide, windrowBeyond, windrowSweep } from '../src/vehicles/quadLogic.js';
import { bulletin, rhoAt } from '../src/gameplay/weather.js';
import { Night, iceOver, newRep, DONE } from '../src/gameplay/Night.js';
import { load, persist, fresh, exists } from '../src/core/save.js';
import { buy, spend, fuelCost, CATALOG, toolsOf } from '../src/gameplay/economy.js';
import { blowerStep, blowerSpec, blowerRpm, kgAhead, refuel, PenaltyGate, BLOWER_UPGRADES, GAME_H_PER_S } from '../src/vehicles/blowerLogic.js';

assert.equal(clamp(5, 0, 1), 1);

// --- Tâche 2 : grille de neige ---
{ const f = new SnowField({ id: 'a', x0: 0, z0: 0, w: 4, d: 10 }); f.fill(0.2, DENS.powder);
  assert.ok(Math.abs(f.mass() - 4 * 10 * 0.2 * 100) < 1);       // 800 kg
  assert.equal(f.cleanFraction(), 0);
  const s = new Snow(); s.add(f); const m0 = s.total();
  s.deposit(2, 5, 50, 100, 0.3); s.deposit(20, 20, 30, 100, 0.3); // dans la zone, puis sur l'herbe
  assert.ok(Math.abs(s.total() - (m0 + 80)) < 0.01);
  assert.equal(s.ground.length, 1); assert.ok(Math.abs(s.ground[0].kg - 30) < 0.01); }
{ const f = new SnowField({ id: 'b', x0: 0, z0: 0, w: 1, d: 1 }); f.fill(0.005, 100); assert.equal(f.cleanFraction(), 1); }
// bord de zone : la part hors zone va au sol, rien ne disparaît ; disque minuscule : tout dans la cellule
{ const f = new SnowField({ id: 'c', x0: 0, z0: 0, w: 2, d: 2 }), s = new Snow(); s.add(f);
  s.deposit(0, 1, 40, 100, 0.3); assert.ok(Math.abs(s.total() - 40) < 0.01); assert.equal(s.ground.length, 1);
  assert.ok(s.ground[0].kg > 0 && s.ground[0].kg < 40);
  s.deposit(1, 1, 10, 100, 0.001); assert.ok(Math.abs(s.total() - 50) < 0.01); assert.ok(f.mass() > 10);
  s.deposit(0.1, 5, 7, 100, 0.2); assert.equal(s.ground.length, 2);
  s.deposit(0.3, 5, 3, 100, 0.2); assert.equal(s.ground.length, 2); } // fusion < 0,5 m
// takeCell, addAt, pack, snow, cellAt, morceaux
{ const f = new SnowField({ id: 'd', x0: 1, z0: 2, w: 10, d: 10 }); f.fill(0.1, 100);
  assert.equal(f.nx, 100); assert.equal(f.chunksX, 2); assert.equal(f.chunksZ, 2);
  assert.equal(f.cellAt(0.5, 3), -1); const i = f.cellAt(1.05, 2.05); assert.equal(i, 0);
  assert.equal(f.cellAt(1.05 + 8.5, 2.05 + 8.5), 85 * 100 + 85);
  f.dirty.clear(); const got = f.takeCell(f.cellAt(9.5, 9.5), 0.04);
  assert.ok(Math.abs(got - 0.04) < 1e-5); assert.deepEqual([...f.dirty], [1]);
  assert.ok(Math.abs(f.takeCell(0, 99) - 0.1) < 1e-6); assert.equal(f.h[0], 0);
  const m = f.mass(); assert.equal(f.addAt(0, 0, 1, 100), false); assert.equal(f.addAt(2, 3, 1, 400), true);
  assert.ok(Math.abs(f.mass() - m - 1) < 1e-3);
  const j = f.cellAt(5, 5), mj = f.h[j] * f.rho[j]; f.pack(j, 0.5);
  assert.ok(f.rho[j] > 100 && f.rho[j] <= DENS.packedMax && Math.abs(f.h[j] * f.rho[j] - mj) < 1e-3);
  const m1 = f.mass(); f.snow(2, 1, 100); assert.ok(Math.abs(f.mass() - m1 - 10 * 10 * 0.02 * 100) < 0.5); }

// --- Tâche 3 : lame et jet ---
{ const s = new Snow(), a = new SnowField({ id: 'a', x0: 0, z0: 0, w: 2, d: 2 }), b = new SnowField({ id: 'b', x0: 2, z0: 0, w: 2, d: 2 });
  a.fill(0.1, 100); b.fill(0.1, 100); s.add(a); s.add(b); const m0 = s.total();
  const load = { kg: 0, rho: 100 };
  for (let z = 0.1; z < 2; z += 0.1) pushBlade(s, { x: 2, z, yaw: 0, width: 0.5, down: true, side: 1, capacity: 8 }, load);
  assert.ok(Math.abs(s.total() + load.kg - m0) < 0.01);        // conservation, lame à cheval sur a et b
  assert.ok(load.kg <= 8 + 1e-6);
  throwLoad(s, load, 3, 1); assert.equal(load.kg, 0); assert.ok(Math.abs(s.total() - m0) < 0.01); }
{ const s = new Snow(), f = new SnowField({ id: 'g', x0: 0, z0: 0, w: 1, d: 1 }); f.fill(0.05, 300); f.ice.fill(1); s.add(f);
  const load = { kg: 0, rho: 300 }; pushBlade(s, { x: 0.5, z: 0.5, yaw: 0, width: 0.5, down: true, side: 0, capacity: 8, steel: false }, load);
  assert.ok(load.kg > 0); assert.ok(f.ice.every((v) => v === 1)); } // la neige part, la glace reste (lame de base)
// zones superposées : chaque cellule prise une fois (seule la 1re zone est raclée) ; lame relevée : rien
{ const s = new Snow(), a = new SnowField({ id: 'a', x0: 0, z0: 0, w: 2, d: 2 }), b = new SnowField({ id: 'b', x0: 0, z0: 0, w: 2, d: 2 });
  a.fill(0.1, 100); b.fill(0.1, 100); s.add(a); s.add(b); const load = { kg: 0, rho: 100 };
  pushBlade(s, { x: 1, z: 1, yaw: 0, width: 0.5, down: false, side: 0, capacity: 8 }, load); assert.equal(load.kg, 0);
  pushBlade(s, { x: 1, z: 1, yaw: 0, width: 0.5, down: true, side: 0, capacity: 8 }, load);
  assert.ok(load.kg > 0 && a.mass() < 40 - 1e-3 && Math.abs(b.mass() - 40) < 1e-3); }
// côté du déversement : side +1 = droite du conducteur ; avant = (sin yaw, cos yaw)
{ const spillCentroid = (yaw, side) => {
    const s = new Snow(), f = new SnowField({ id: 'p', x0: 0, z0: 0, w: 6, d: 6 }); s.add(f);
    f.h[f.cellAt(3, 3.05)] = 0.5; f.h[f.cellAt(3.05, 3)] = 0.5;
    pushBlade(s, { x: 3, z: 3, yaw, width: 0.5, down: true, side, capacity: 0 }, { kg: 0, rho: 100 });
    let m = 0, cx = 0, cz = 0;
    for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) { const w = f.h[iz * f.nx + ix]; m += w; cx += w * (ix + 0.5) * 0.1; cz += w * (iz + 0.5) * 0.1; }
    assert.ok(m > 0); return [cx / m - 3, cz / m - 3]; };
  assert.ok(spillCentroid(0, 1)[0] < -0.3); assert.ok(spillCentroid(0, -1)[0] > 0.3);
  assert.ok(spillCentroid(Math.PI / 2, 1)[1] > 0.3); assert.ok(spillCentroid(Math.PI / 2, -1)[1] < -0.3); }
// verglas : la lame de base prend la neige posée dessus mais laisse la glace ; la lame acier prend la neige et la glace
{ const f = new SnowField({ id: 'i', x0: 0, z0: 0, w: 1, d: 1 }), s = new Snow(); s.add(f); f.fill(0.1, 100); f.ice.fill(1);
  const i = f.cellAt(0.55, 0.55), load = { kg: 0, rho: 100 };
  pushBlade(s, { x: 0.55, z: 0.5, yaw: 0, width: 0.5, down: true, side: 0, capacity: 100, steel: false }, load);
  assert.equal(f.h[i], 0); assert.equal(f.ice[i], 1); assert.ok(load.kg > 0);
  f.h[i] = 0.1; const l2 = { kg: 0, rho: 100 };
  pushBlade(s, { x: 0.55, z: 0.5, yaw: 0, width: 0.5, down: true, side: 0, capacity: 100, steel: true }, l2);
  assert.equal(f.h[i], 0); assert.equal(f.ice[i], 0); assert.ok(l2.kg > 0);
  f.ice[i] = 1; scoopIce(f, i, false); assert.equal(f.ice[i], 1); scoopIce(f, i, true); assert.equal(f.ice[i], 0); }

// morceaux : une cellule en colonne 0 / ligne 0 d'un morceau marque aussi le morceau voisin (marge de texture)
{ const f = new SnowField({ id: 'm', x0: 0, z0: 0, w: 20, d: 20 }); f.fill(0.1, 100); f.dirty.clear();
  f.takeCell(80, 1); assert.deepEqual([...f.dirty].sort(), [0, 1]);
  f.dirty.clear(); f.takeCell(81 + 80 * f.nx, 1); assert.deepEqual([...f.dirty].sort(), [0, 1, f.chunksX, f.chunksX + 1].sort());
  f.dirty.clear(); f.takeCell(40 + 40 * f.nx, 1); assert.deepEqual([...f.dirty], [0]); }
// éboulement : 50 kg sur un point, pente finale <= 0,9, masse conservée
{ const f = new SnowField({ id: 'r', x0: 0, z0: 0, w: 2, d: 2 }), m0 = 50;
  f.addAt(1.05, 1.05, 50, 100); assert.ok(Math.abs(f.mass() - m0) < 1e-3);
  let n = 0; while (f.active.size && n++ < 100000) f.relax();
  assert.ok(f.active.size === 0, 'relax converge');
  let mx = 0; const { nx, nz, h } = f;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) { const i = iz * nx + ix;
    if (ix + 1 < nx) mx = Math.max(mx, Math.abs(h[i] - h[i + 1]) / 0.1); if (iz + 1 < nz) mx = Math.max(mx, Math.abs(h[i] - h[i + nx]) / 0.1); }
  assert.ok(mx <= 0.9 + 0.01, 'pente ' + mx); assert.ok(Math.abs(f.mass() - m0) < 1e-2, 'masse ' + f.mass()); }
// sillon + bourrelet : après éboulement, aucune pente > 0,9 et masse conservée
{ const sn = new Snow(), f = new SnowField({ id: 'v', x0: 0, z0: 0, w: 6, d: 10 }); f.fill(0.2, 100); sn.add(f);
  const load = { kg: 0, rho: 100 }, m0 = sn.total();
  for (let z = 1; z <= 9; z += 0.05) pushBlade(sn, { x: 3, z, yaw: 0, width: 1.5, down: true, side: 1, capacity: 50 }, load);
  let n = 0; while (f.active.size && n++ < 100000) f.relax();
  assert.ok(f.active.size === 0); assert.ok(Math.abs(sn.total() + load.kg - m0) < 1e-2);
  let mx = 0, mh = 0; for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) { const i = iz * f.nx + ix; mh = Math.max(mh, f.h[i]);
    const sl = (p, q) => { const hi = f.h[p] >= f.h[q] ? p : q; if (f.loose[hi] > 1e-6) mx = Math.max(mx, Math.abs(f.h[p] - f.h[q]) / 0.1); }; // seule la neige meuble éboule
    if (ix + 1 < f.nx) sl(i, i + 1); if (iz + 1 < f.nz) sl(i, i + f.nx); }
  assert.ok(mx <= 0.9 + 0.01, 'pente ' + mx); assert.ok(mh < 0.8, 'hauteur ' + mh); }
// neige tassée : une coupe verticale tient, la voie dégagée ne se remplit pas
{ const f = new SnowField({ id: 'c', x0: 0, z0: 0, w: 4, d: 2 }); f.fill(0.2, 100);
  for (let iz = 0; iz < f.nz; iz++) for (let ix = 20; ix < 25; ix++) f.takeCell(iz * f.nx + ix, Infinity);
  let n = 0; while (f.active.size && n++ < 1000) f.relax();
  for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) { const h = f.h[iz * f.nx + ix];
    if (ix >= 20 && ix < 25) assert.ok(h < 0.01, 'voie propre'); else assert.ok(Math.abs(h - 0.2) < 1e-6, 'bords à 20 cm'); } }
// tas jeté au bord d'une coupe : le tas s'éboule, le mur tassé ne perd rien
{ const f = new SnowField({ id: 'w', x0: 0, z0: 0, w: 4, d: 2 }); f.fill(0.2, 100);
  for (let iz = 0; iz < f.nz; iz++) for (let ix = 20; ix < 25; ix++) f.takeCell(iz * f.nx + ix, Infinity);
  const m0 = f.mass(); f.addAt(1.95, 1.0, 20, 100);
  let n = 0; while (f.active.size && n++ < 100000) f.relax();
  assert.ok(Math.abs(f.mass() - m0 - 20) < 1e-2, 'masse'); let mh = 0;
  for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) { const h = f.h[iz * f.nx + ix]; mh = Math.max(mh, h); if (ix < 20 || ix >= 25) assert.ok(h >= 0.2 - 1e-6, 'mur intact'); }
  assert.ok(mh < 1, 'le tas a éboulé : ' + mh); }
// tas meuble contre le bord d'un champ (Snow.add) : une partie part au sol (tas), masse conservée ; neige tassée : rien ne sort
{ const sn = new Snow(), f = new SnowField({ id: 'e', x0: 0, z0: 0, w: 2, d: 4 }); sn.add(f); f.fill(0.2, 100);
  const m0 = sn.total(); f.addAt(1.95, 2.05, 30, 100);
  let n = 0; while (f.active.size && n++ < 100000) f.relax();
  const g = sn.ground.reduce((a, p) => a + p.kg, 0);
  assert.ok(g > 1 && g < 30, 'au sol ' + g); assert.ok(sn.ground.every((p) => p.x > 2)); assert.ok(Math.abs(sn.total() - m0 - 30) < 1e-2, 'masse'); }
// deux champs voisins (marches, trottoirs) : le bord commun reste un mur, rien ne va au sol
{ const sn = new Snow(), a = new SnowField({ id: 'a', x0: 0, z0: 0, w: 2, d: 4 }), b = new SnowField({ id: 'b', x0: 2, z0: 0, w: 2, d: 4 });
  sn.add(a); sn.add(b); const m0 = sn.total(); a.addAt(1.95, 2.05, 10, 100);
  let n = 0; while (a.active.size && n++ < 100000) a.relax();
  assert.equal(sn.ground.length, 0); assert.ok(Math.abs(sn.total() - m0 - 10) < 1e-2); }
// --- Tâche 5 : règles, horloge, contrats ---
assert.equal(pay(100, 0.69, false, 0), 0); assert.equal(pay(100, 0.95, false, 0), 100); assert.equal(pay(100, 0.825, false, 0), 50);
assert.equal(pay(100, 1, true, 10), 110); assert.equal(pay(20, 0.8, false, 50), 0);
assert.equal(stars(0.97, 0), 2); assert.equal(stars(0.99, 5), 2); assert.equal(stars(0.99, 0), 3);
assert.ok(Math.abs(walkFactor(4, 8) - 0.7) < 1e-9);
{ const st = new Stamina(); st.spend(100); assert.ok(st.exhausted); st.update(3, 'idle'); assert.ok(st.exhausted); st.update(1, 'idle'); assert.ok(!st.exhausted); }
{ const c = new NightClock(); c.update(5 * 60); assert.equal(c.label(), '5:00'); assert.ok(c.at(4 * 60 + 30)); assert.ok(!c.at(4 * 60 + 30)); c.update(5 * 120); assert.ok(c.done); }
{ const z = [...Array(10)].map((_, i) => ({ id: 'z' + i, tool: i < 6 ? 'pelle' : 'quad', base: 30, deadline: 420 }));
  const cs = drawContracts(z, { rep: 0, tools: ['pelle'], weather: { wet: false } }, rng(1));
  assert.ok(cs.length >= 5 && cs.length <= 6 && cs.every((c) => c.tool === 'pelle'));
  assert.deepEqual(cs, drawContracts(z, { rep: 0, tools: ['pelle'], weather: { wet: false } }, rng(1)));
  const w = drawContracts(z, { rep: 0, tools: ['pelle', 'quad'], weather: { wet: true } }, rng(2)); assert.ok(w.length <= 7 && w.every((c) => c.base === 38)); }
{ const f = new SnowField({ id: 'z', x0: 0, z0: 0, w: 1, d: 1 }); f.fill(0, 100); const s = new Snow(); s.add(f);
  const k = { zoneIds: ['z'], base: 100, deadline: 420 };
  let r = evaluate(k, s, null, 0); assert.equal(r.p, 1); assert.equal(r.pay, 100); assert.equal(r.stars, 3);
  r = evaluate({ ...k, finishedAt: 390 }, s, null, 10); assert.equal(r.pay, 110); assert.equal(r.stars, 2); }
// --- Tâche 6 : le quartier ---
// pente linéaire d'un champ : baseY aux deux bouts ; sans pente, baseY = y
{ const f = new SnowField({ id: 'p', x0: 2, z0: 10, w: 4, d: 25, y: 0.5, slope: { dx: 0, dz: 0.09 } });
  assert.ok(Math.abs(f.baseY(3, 10) - 0.5) < 1e-9 && Math.abs(f.baseY(3, 35) - 2.75) < 1e-9);
  const g = new SnowField({ id: 'q', x0: 0, z0: 0, w: 2, d: 2, y: 0.34 }); assert.equal(g.baseY(1, 1), 0.34);
  assert.equal(new SnowField({ id: 'r', x0: 0, z0: 0, w: 0.3, d: 4 }).nx, 3); }
{ const { LAYOUT } = await import('../src/world/layout.js');
  assert.equal(LAYOUT.houses.length, 24);
  const ov = (a, b) => a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.z0 < b.z0 + b.d && b.z0 < a.z0 + a.d;
  for (const z of LAYOUT.zones) for (const r of LAYOUT.roads) assert.ok(!ov(z.rect, r), z.id + ' empiète sur une rue');
  assert.ok(LAYOUT.zones.find((z) => z.kind === 'parking' && z.rect.w * z.rect.d === 1200 && z.tool === 'quad'));
  assert.equal(LAYOUT.zones.filter((z) => z.kind === 'stairs').length, 20);
  const E = 1e-9, ovt = (a, b) => a.x0 < b.x0 + b.w - E && b.x0 < a.x0 + a.w - E && a.z0 < b.z0 + b.d - E && b.z0 < a.z0 + a.d - E; // marches : bords au dixième près
  // champs de neige : jamais superposés, ni sur une rue ; taille en cellules exacte
  const snowRects = [...LAYOUT.zones.map((z) => [z.id, z.rect]), ...LAYOUT.sidewalks.map((r, i) => ['trottoir ' + i, r])];
  for (let i = 0; i < snowRects.length; i++) {
    const [ia, a] = snowRects[i], f = new SnowField({ id: ia, ...a });
    assert.ok(f.nx === Math.round(a.w / 0.1) && f.nz === Math.round(a.d / 0.1), ia + ' : taille hors grille');
    for (const r of LAYOUT.roads) assert.ok(!ov(a, r), ia + ' empiète sur une rue');
    for (let j = i + 1; j < snowRects.length; j++) assert.ok(!ovt(a, snowRects[j][1]), ia + ' recouvre ' + snowRects[j][0]);
  }
  // allées : bouche de 1 m dans l'allée, collée à une rue ; zone de la maison = son allée
  const touches = (m, r) => (m.z0 === r.z0 + r.d || m.z0 + m.d === r.z0) && m.x0 < r.x0 + r.w && r.x0 < m.x0 + m.w;
  for (const h of LAYOUT.houses) {
    const z = LAYOUT.zones.find((q) => q.id === h.zone), m = h.drive.mouth, dr = h.drive;
    assert.ok(z && z.kind === 'drive' && z.rect === dr, h.zone);
    assert.ok(m.d === 1 && m.x0 >= dr.x0 && m.x0 + m.w <= dr.x0 + dr.w && m.z0 >= dr.z0 && m.z0 + m.d <= dr.z0 + dr.d, h.zone + ' : bouche hors allée');
    assert.ok(LAYOUT.roads.some((r) => touches(m, r)), h.zone + ' : bouche loin de la rue');
    assert.ok(dr.w >= 3 && dr.w <= 4 && ((dr.d >= 8 && dr.d <= 20) || h.zone === 'allee-7'), h.zone + ' : taille');
  }
  // emprises des bâtiments et voitures garées : hors rues, hors neige, sans chevauchement
  const foot = (b) => { const q = Math.abs(Math.sin(b.yaw)) > 0.5, w = q ? b.d : b.w, d = q ? b.w : b.d; return { x0: b.x - w / 2, z0: b.z - d / 2, w, d }; };
  const blds = [...LAYOUT.houses, ...LAYOUT.buildings].map(foot);
  for (let i = 0; i < blds.length; i++) {
    for (const [id, r] of snowRects) assert.ok(!ov(blds[i], r), 'bâtiment ' + i + ' sur ' + id);
    for (const r of LAYOUT.roads) assert.ok(!ov(blds[i], r), 'bâtiment ' + i + ' sur une rue');
    for (let j = i + 1; j < blds.length; j++) assert.ok(!ov(blds[i], blds[j]), 'bâtiments ' + i + ' et ' + j);
  }
  for (const c of LAYOUT.parked) for (const [id, r] of snowRects) assert.ok(!ov(foot({ ...c, w: 2, d: 5 }), r), 'voiture sur ' + id);
  for (const r of [...snowRects.map((s) => s[1]), ...LAYOUT.roads, LAYOUT.depot]) assert.ok(r.x0 >= 0 && r.z0 >= 0 && r.x0 + r.w <= 300 && r.z0 + r.d <= 300);
  // contrats du §7 : l'escalier (20 marches) est un seul contrat
  for (const id of ['allee-12', 'trottoir-boulangerie', 'acces-pharmacie', 'allee-7', 'cour-ecole', 'parking-supermarche', 'chemin-lotissement']) assert.ok(LAYOUT.zones.find((z) => z.id === id), id);
  const steps = LAYOUT.zones.filter((z) => z.kind === 'stairs');
  steps.forEach((z, k) => assert.ok(Math.abs(z.y - 0.17 * (k + 1)) < 1e-9 && z.group === 'escalier-eglise' && z.rect.w === 0.3 && z.rect.x0 === Math.round(z.rect.x0 * 10) / 10));
  // grande allée en pente : monte en s'éloignant de la rue, la maison est posée au sommet
  const a7 = LAYOUT.zones.find((z) => z.id === 'allee-7'), h7 = LAYOUT.houses.find((h) => h.zone === 'allee-7');
  const f7 = new SnowField({ id: 'a7', ...a7.rect, slope: a7.slope }), r7 = a7.rect;
  assert.ok(a7.slope.dz >= 0.08 && a7.slope.dz <= 0.1);
  assert.ok(Math.abs(f7.baseY(r7.x0 + 1, r7.z0)) < 1e-9 && Math.abs(f7.baseY(r7.x0 + 1, r7.z0 + r7.d) - h7.y) < 1e-9);
  for (let s = 1; s < 30; s++) {
    const cs = drawContracts(LAYOUT.zones, { rep: 20, tools: ['pelle', 'fraise', 'quad'] }, rng(s));
    assert.ok(cs.filter((c) => c.zoneIds.some((id) => id.startsWith('escalier'))).length <= 1);
    const st = cs.find((c) => c.zoneIds.length > 1); if (st) assert.ok(st.zoneIds.length === 20 && st.base === 45 && st.deadline === 390);
  }
  for (const z of LAYOUT.zones) assert.ok(['pelle', 'fraise', 'quad'].includes(z.tool) && z.base > 0 && z.deadline >= 360 && z.deadline <= 420, z.id); }
// --- Tâche 7 : pelles et équipement ---
assert.equal(SHOVELS.pusher.noThrow, true); assert.equal(SHOVELS.large.capacity, 12); assert.equal(GEAR.sled, 120);
assert.deepEqual(SHOVELS.base, { width: 0.5, capacity: 8, price: 0 });
assert.deepEqual(GEAR, { steel: 70, gloves: 40, boots: 50, sled: 120, salt: 10 });
assert.ok(!SHOVELS.base.noThrow && !SHOVELS.large.noThrow);
assert.deepEqual(EFFECTS, { gloves: 20, boots: 0.75, sled: 60, salt: { area: 20, minutes: 2 } });
// --- Tâche 7 : obstacles (cercle contre rectangle orienté) ---
{ const { LAYOUT } = await import('../src/world/layout.js');
  const near = (a, b) => Math.abs(a - b) < 1e-9, box = { x: 10, z: 20, hw: 2, hd: 1, yaw: 0 };
  assert.equal(pushOut(13, 20, 0.3, box), null);                       // loin
  let m = pushOut(12.1, 20, 0.3, box); assert.ok(near(m[0], 0.2) && near(m[1], 0)); // frôle la face +x : sort de 0,2 m
  m = pushOut(10, 20.9, 0.3, box); assert.ok(near(m[0], 0) && near(m[1], 0.4));     // centre dedans, face +z la plus proche
  const rot = { ...box, yaw: Math.PI / 2 };                              // tourné : la longueur passe sur z
  assert.equal(pushOut(11.5, 20, 0.3, rot), null); m = pushOut(10, 22.1, 0.3, rot); assert.ok(near(m[0], 0) && Math.abs(m[1] - 0.2) < 1e-9);
  const [x, z] = collide(12.1, 20, 0.3, [box, rot]); assert.ok(near(x, 12.3) && near(z, 20));
  const S = solidsFrom(LAYOUT), cars = S.filter((s) => s.car);
  assert.equal(S.length, LAYOUT.houses.length + LAYOUT.buildings.length + LAYOUT.parked.length + 7);
  assert.equal(cars.length, LAYOUT.parked.length);
  const free = (px, pz) => { const [a, b] = collide(px, pz, 0.3, S); return a === px && b === pz; };
  assert.ok(free(130.5, 123));                                           // départ du joueur
  for (const zn of LAYOUT.zones) { const r = zn.rect; assert.ok(free(r.x0 + r.w / 2, r.z0 + r.d / 2), 'obstacle sur ' + zn.id); }
  assert.ok(free(166, 230) && free(169, 230) && !free(168, 220) && !free(171, 230));        // escalier -> parvis ouvert, mur du parvis ailleurs, église à x 170
  const h = LAYOUT.houses[0]; assert.ok(!free(h.x, h.z)); }
// --- Tâche 8 : véhicules ---
assert.equal(snowDrag(0.2, 'pickup').stuck, false); assert.ok(snowDrag(0.3, 'pickup').drag > 0);
assert.equal(snowDrag(0.45, 'quad').drag, 0.5); assert.equal(snowDrag(0.75, 'quad').stuck, true);
assert.equal(snowDrag(0.3, 'pickup').stuck, true); assert.equal(snowDrag(0.3, 'quad').drag, 0);
{ const dim = { length: 5.8, width: 2.3, wheelbase: 3.2, rearBehind: 1.5 }, run = (ph, s, inp) => { for (let t = 0; t < s; t += 1 / 60) ph.step(1 / 60, inp); return ph; };
  const go = { throttle: 1, brake: 0, steer: 0, hand: false };
  const a = run(new CarPhysics(dim), 20, go); assert.ok(Math.abs(a.v - a.vmax) < 0.3 && a.z > 100 && Math.abs(a.x) < 1e-6); // tout droit vers +z
  const b = new CarPhysics(dim); b.drag = 0.9; run(b, 10, go); assert.ok(b.v > 0.5 && b.v <= 1.41);   // patine : avance au pas
  const c = new CarPhysics(dim); c.v = 14; c.drag = 0.9; run(c, 3, go); assert.ok(c.v < 1.5);          // entrer vite dans 30 cm : freiné
  // adhérence : freinage à 50 km/h plus long sur neige, virage moins serré (accélération latérale ≤ g × grip)
  const stop = (grip) => { const k = new CarPhysics(dim); k.grip = grip; k.v = 13.9; let z0 = k.z; run(k, 6, { ...go, throttle: 0, brake: 1 }); return k.z - z0; };
  assert.ok(stop(0.4) > stop(1) * 1.8);
  // glissade : virage à fond à 30 km/h, pneus 0,6 ; rayon de la trajectoire = vitesse / rotation de la vitesse dans le monde
  const curve = (mu, kmh, secs = 1.5, hand = false, thr = 0.3) => {
    const k = new CarPhysics(dim); k.grip = 0.6; k.mu = mu; k.v = kmh / 3.6; let maxVl = 0;
    const dirOf = () => Math.atan2(Math.sin(k.yaw) * k.v + Math.cos(k.yaw) * k.vl, Math.cos(k.yaw) * k.v - Math.sin(k.yaw) * k.vl);
    run(k, 0.3, { ...go, throttle: 0, steer: 1, hand }); const a0 = dirOf(), s0 = k.speed; let t = 0;
    for (; t < secs; t += 1 / 60) { k.step(1 / 60, { ...go, throttle: thr, steer: 1, hand }); maxVl = Math.max(maxVl, Math.abs(k.vl)); }
    return { R: ((s0 + k.speed) / 2) / ((dirOf() - a0) / t), maxVl, k };
  };
  const ice = curve(MU.ice, 30), asph = curve(MU.asphalt, 30), slow = curve(MU.packed, 10, 1, false, 0), bare = curve(MU.asphalt, 10, 1, false, 0);
  assert.ok(ice.maxVl > 0.05 && ice.R > asph.R * 2, `glace : vl ${ice.maxVl}, R ${ice.R} / ${asph.R}`);   // (a) la glace glisse et élargit le virage
  assert.ok(ice.k.yawRate > 0 && ice.k.yawRate < 0.2);                                                    // cap borné, steer > 0 = gauche
  assert.ok(bare.maxVl < 1e-9 && curve(MU.packed, 30).R > asph.R * 1.4);                                // chaussée nue : tient mieux que la neige tassée
  const kin = slow.k.v * Math.tan(slow.k.steer) / dim.wheelbase;
  assert.ok(slow.maxVl < 0.02 && Math.abs(slow.k.yawRate - kin) < 1e-6, `10 km/h : vl ${slow.maxVl}`);                                   // (b) chaussée à 10 km/h : comme avant
  const hb = curve(MU.packed, 30, 0.8, true), nb = curve(MU.packed, 30, 0.8, false);
  assert.ok(hb.maxVl > nb.maxVl && Math.abs(hb.k.yaw) > Math.abs(nb.k.yaw) * 1.2);                        // frein à main : survirage
  for (const dt of [0, 0.05]) { const k = curve(MU.ice, 30).k; k.step(dt, { ...go, steer: 1 }); assert.ok([k.v, k.vl, k.yaw, k.acc, k.rx].every(Number.isFinite)); } // (c)
  const st = curve(MU.ice, 40).k; run(st, 10, { ...go, throttle: 0, steer: 0 }); assert.ok(Math.abs(st.vl) < 1e-9 && Math.abs(st.v) < 1e-9); // la glissade s'éteint
  // collision : un mur devant, la caisse ne le traverse pas, impact compté au-delà de 2 m/s
  const w = new CarPhysics(dim), wall = [{ x: 0, z: 6, hw: 5, hd: 0.5, yaw: 0 }]; w.place(0, 0, 0); let hit = 0;
  for (let t = 0; t < 4; t += 1 / 60) { w.step(1 / 60, go); hit = Math.max(hit, collideCar(w, wall)); }
  assert.ok(w.z + 2.9 <= 5.5 + 0.05 && hit > 2 && Math.abs(w.v) < 0.5);
  const z0 = new CarPhysics(dim); z0.step(0, go); assert.ok(Number.isFinite(z0.acc));   // deux images au même instant
  const side = new CarPhysics(dim); side.place(0, 0, Math.PI / 2); assert.equal(collideCar(side, [{ x: 0, z: 2, hw: 1, hd: 0.5, yaw: 0 }]), 0); }
// montée / descente : le plus proche à moins de 2,5 m, descente côté conducteur ou du côté libre, fraise chargée par la rampe
{ assert.equal(distRect(3, 0, { x: 0, z: 0, hw: 1, hd: 2, yaw: 0 }), 2); assert.equal(distRect(0.5, 1, { x: 0, z: 0, hw: 1, hd: 2, yaw: 1 }), 0);
  const car = (id, x, z) => ({ id, solid: { x, z, hw: 1.15, hd: 2.9, yaw: 0 }, phys: { yaw: 0 }, n: 0, enter() { this.n++; }, exit() { this.n--; } });
  const pick = Object.assign(car('pickup', 0, 0), { bed: new Set(['jerrycan']), nearTailgate: (x, z) => z < -2.9 && z > -5.5 && Math.abs(x) < 1.5,
    loadBlower(b) { this.bed.add('blower'); b.stowed = true; return true; }, unloadBlower(b) { this.bed.delete('blower'); b.stowed = false; return true; } });
  const far = car('quad', 30, 0), seat = new Seat(), wk = { position: { x: 4, z: 0 }, yaw: 0, solids: [] };
  assert.equal(seat.tryToggle(wk, [pick, far]), null);                       // 2,85 m : trop loin
  wk.position.x = 3.4; assert.equal(seat.tryToggle(wk, [pick, far]), 'enter'); assert.equal(seat.current, 'pickup'); assert.equal(pick.n, 1);
  pick.phys.v = 4; assert.equal(seat.tryToggle(wk, [pick, far]), null); pick.phys.v = 0;   // pas de descente en roulant
  assert.equal(seat.tryToggle(wk, [pick, far]), 'exit'); assert.equal(seat.current, 'walker'); assert.ok(wk.position.x > 1.15 && Math.abs(wk.position.z) < 1e-9);
  seat.tryToggle(wk, [pick]); wk.solids = [{ x: 2, z: 0, hw: 0.5, hd: 4, yaw: 0 }];  // mur contre la portière conducteur : descente à droite
  seat.tryToggle(wk, [pick]); assert.ok(wk.position.x < -1.15);
  const blower = car('blower', 0, -4.5); wk.solids = []; wk.position = { x: 0, z: -6 };
  assert.equal(seat.tryToggle(wk, [pick, blower]), 'enter'); assert.equal(seat.current, 'blower');
  assert.equal(seat.tryToggle(wk, [pick, blower]), 'load'); assert.ok(pick.bed.has('blower') && blower.stowed);
  wk.position = { x: 0, z: -4 }; assert.equal(seat.tryToggle(wk, [pick, blower]), 'unload'); assert.ok(!pick.bed.has('blower') && !blower.stowed); }
// --- Tâche 9 : fraise à neige ---
{ const r = blowerStep({}, 0.1, { want: 3 / 3.6, depthKgPerM: 10, power: 6 }); assert.ok(Math.abs(r.speed - 3 / 3.6) < 1e-6); }
{ let s = {}, r; for (let i = 0; i < 12; i++) r = blowerStep(s, 0.1, { want: 3 / 3.6, depthKgPerM: 100, power: 6 }); assert.ok(r.stalled); }
{ const st = { fuel: 0 }; const r = blowerStep(st, 0.1, { want: 1, depthKgPerM: 1, power: 6 }); assert.equal(r.speed, 0); }
{ // débit 25 kg/s (6 ch), 37,5 (9 ch) : l'avance ralentit sans caler sous 1,5 fois le possible ; calée, elle reste arrêtée
  const a = blowerStep({}, 0.1, { want: 0.5, depthKgPerM: 100, power: 6 }); assert.ok(Math.abs(a.speed - 0.25) < 1e-9 && Math.abs(a.kgPerSec - 25) < 1e-9 && !a.stalled);
  const b = blowerStep({}, 0.1, { want: 0.5, depthKgPerM: 100, power: 9 }); assert.ok(Math.abs(b.kgPerSec - 37.5) < 1e-9);
  const s = {}; let r; for (let i = 0; i < 30; i++) r = blowerStep(s, 0.1, { want: 0.37, depthKgPerM: 100, power: 6 }); assert.ok(!r.stalled);
  for (let i = 0; i < 10; i++) r = blowerStep(s, 0.1, { want: 3 / 3.6, depthKgPerM: 100, power: 6 }); assert.ok(!r.stalled); // 1,0 s : pas encore
  r = blowerStep(s, 0.1, { want: 3 / 3.6, depthKgPerM: 100, power: 6 }); assert.ok(r.stalled);
  r = blowerStep(s, 0.1, { want: 0.1, depthKgPerM: 0, power: 6 }); assert.equal(r.speed, 0);                // calée : relance obligatoire
  s.stalled = false; s.overT = 0; r = blowerStep(s, 0.1, { want: -0.5, depthKgPerM: 100, power: 6 }); assert.equal(r.speed, -0.5); // recule sans avaler
  assert.equal(blowerStep({}, 0.1, { want: 0.5, depthKgPerM: 0, power: 6 }).speed, 0.5); }               // chaussée dégagée
{ // essence en heures de jeu (5 s réelles par minute) : 0,6 L/h à 6 ch, 0,9 à 9 ch ; vide -> arrêt
  assert.ok(Math.abs(GAME_H_PER_S - 1 / 300) < 1e-12);
  const s = { fuel: 2 }; blowerStep(s, 300, { want: 0, depthKgPerM: 0, power: 6 }); assert.ok(Math.abs(s.fuel - 1.4) < 1e-9);
  const t = { fuel: 2 }; blowerStep(t, 300, { want: 0, depthKgPerM: 0, power: 9 }); assert.ok(Math.abs(t.fuel - 1.1) < 1e-9);
  const u = { fuel: 0.001 }; blowerStep(u, 300, { want: 0.5, depthKgPerM: 0, power: 6 }); assert.equal(u.fuel, 0);
  assert.equal(blowerStep(u, 0.1, { want: 0.5, depthKgPerM: 0, power: 6 }).speed, 0); }
{ assert.deepEqual(BLOWER_UPGRADES, { motor: 250, width: 300, tank: 120, lights: 80, chute: 150 });
  assert.deepEqual(blowerSpec({}), { power: 6, width: 0.56, tank: 2, range: 6 });
  assert.deepEqual(blowerSpec({ motor: true, width: true, tank: true, chute: true }), { power: 9, width: 0.71, tank: 4, range: 10 }); }
{ // kg par mètre d'avance mesurés devant l'entrée : 20 cm de poudreuse sur 0,56 m = 11,2 kg/m (à une colonne de cellules près)
  const f = new SnowField({ id: 'k', x0: 0, z0: 0, w: 4, d: 10 }), s = new Snow(); s.add(f); f.fill(0.2, 100);
  assert.ok(Math.abs(kgAhead(s, 2, 3, 0, 0.56, 0.3) - 11.2) < 1.1, String(kgAhead(s, 2, 3, 0, 0.56, 0.3)));
  assert.equal(kgAhead(s, 20, 3, 0, 0.56, 0.3), 0); }
{ // jerrican : +2 L (sans dépasser le réservoir), seulement à portée de la fraise et du pick-up, retiré du plateau
  const pick = { solid: { x: 0, z: 0, hw: 1, hd: 2.5, yaw: 0 }, bed: new Set(['jerrycan']) };
  const b = { fuel: 0, upgrades: {}, solid: { x: 0, z: -4, hw: 0.35, hd: 0.7, yaw: 0 } };
  assert.equal(refuel(b, pick, { x: 10, z: -4 }), false);
  assert.equal(refuel(b, pick, { x: 0, z: -2.9 }), true); assert.equal(b.fuel, 2); assert.ok(!pick.bed.has('jerrycan'));
  assert.equal(refuel(b, pick, { x: 0, z: -2.9 }), false);
  pick.bed.add('jerrycan'); b.fuel = 1.5; assert.equal(refuel(b, pick, { x: 0, z: -2.9 }), true); assert.equal(b.fuel, 2);  // plein à 2 L
  pick.bed.add('jerrycan'); assert.equal(refuel(b, pick, { x: 0, z: -2.9 }), false); assert.ok(pick.bed.has('jerrycan')); }  // déjà plein
{ // calée : on peut reculer (S) avant de réembrayer
  const s = { stalled: true }; assert.equal(blowerStep(s, 0.1, { want: -0.5, depthKgPerM: 0, power: 6 }).speed, -0.5);
  assert.equal(blowerStep(s, 0.1, { want: 0.5, depthKgPerM: 0, power: 6 }).speed, 0); }
{ // jet continu au bord d'une voiture (visée tirée au hasard à chaque image) : une seule pénalité par cible et par visée
  const g = new PenaltyGate(); let n = 0;
  for (let t = 0; t < 5; t += 1 / 60) if (g.hit(Math.sin(t * 97) > 0.3 ? 'car' : null, t)) n++;
  assert.equal(n, 1);
  assert.equal(g.hit('door', 5.1), true);                    // autre cible : sa propre pénalité
  assert.equal(g.hit(null, 5.5), false); assert.equal(g.hit('car', 6.2), true); // plus de 1 s sans toucher la voiture : nouvelle visée
  assert.equal(g.hit('car', 6.9), false); }
{ // régime : 0 coupé ou calée, ralenti turbine débrayée, monte avec la charge, chute vers le calage
  const on = { on: true, auger: true, stalled: false, overT: 0 };
  assert.equal(blowerRpm({ on: false }, 0, 6), 0); assert.equal(blowerRpm({ ...on, stalled: true }, 0, 6), 0);
  const idle = blowerRpm({ ...on, auger: false }, 0, 6), free = blowerRpm(on, 0, 6), full = blowerRpm(on, 25, 6), lug = blowerRpm({ ...on, overT: 0.9 }, 25, 6);
  assert.ok(idle > 0 && idle < free && free < full && lug < idle, [idle, free, full, lug].join());
  assert.ok(Math.abs(blowerRpm(on, 37.5, 9) - full) < 1e-9); }
{ // quad : quart de chaque pneu autour du centre (gauche = +x, avant = +z), 4 quarts distincts
  assert.notEqual(quadrantOf(1, 1, 0, 0), quadrantOf(-1, 1, 0, 0));
  assert.equal(new Set([[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => quadrantOf(x, z, 0, 0))).size, 4);
  assert.equal(quadrantOf(5.2, 3.1, 5, 3), quadrantOf(1, 1, 0, 0)); // autour d'un centre décalé
  assert.deepEqual(QUAD_UPGRADES, { vblade: 500, chains: 200, lights: 150, spreader: 700 });
  assert.equal(BLADE.width, 1.5); assert.equal(BLADE.capacity, 120);
  // chaînes : 0,6 -> 0,9 sur neige tassée et verglas seulement
  assert.equal(quadGrip('packed', false), 0.6); assert.equal(quadGrip('packed', true), 0.9); assert.equal(quadGrip('ice', true), 0.9);
  assert.equal(quadGrip('snow', true), 0.6); assert.equal(quadGrip('asphalt', true), 0.6);
  // lame orientée : débord du côté orienté (angle > 0 = gauche ; pushBlade side +1 = droite), plus de débit qu'une lame droite
  assert.equal(spillSide(0.5, false), -1); assert.equal(spillSide(-0.5, false), 1); assert.equal(spillSide(0, false), 0); assert.equal(spillSide(0.5, true), 0);
  assert.ok(spillPerM(BLADE.maxAngle) > spillPerM(0)); assert.equal(spillPerM(-BLADE.maxAngle), spillPerM(BLADE.maxAngle)); }
{ // lame du quad : spillMax borne le débord, la charge dépasse alors la capacité (roues qui patinent au-delà de 1,5 x)
  const f = new SnowField({ id: 'q', x0: 0, z0: 0, w: 4, d: 20 }), s = new Snow(); s.add(f); f.fill(0.6, 100); // 90 kg/m > 60 qui débordent
  const m0 = s.total(), load = { kg: 0, rho: 100 };
  for (let z = 1; z <= 15; z += 0.1) pushBlade(s, { x: 2, z, yaw: 0, width: 1.5, down: true, side: -1, capacity: 120, steel: false, spillMax: spillPerM(0) * 0.1 }, load);
  assert.ok(load.kg > BLADE.capacity * 1.5, String(load.kg));
  assert.ok(Math.abs(s.total() + load.kg - m0) < 0.5);              // masse conservée (charge + grille + tas)
  const l2 = { kg: 0, rho: 100 }; // sans spillMax : tout le surplus déborde (comportement de la pelle et de la fraise)
  for (let z = 1; z <= 15; z += 0.1) pushBlade(s, { x: 0.8, z, yaw: 0, width: 1.5, down: true, side: 1, capacity: 120, steel: false }, l2);
  assert.ok(l2.kg <= 120 + 1e-9); }
{ // quad bloqué (snowDrag drag 1) : la vitesse reste finie et nulle en avant, la marche arrière reste possible
  const ph = new CarPhysics({ length: 2.1, width: 1.5, wheelbase: 1.25, rearBehind: 0.76 }); ph.drag = snowDrag(0.8, 'quad').drag;
  for (let k = 0; k < 120; k++) ph.step(1 / 60, { throttle: 1, brake: 0, steer: 0, hand: false });
  assert.ok(Number.isFinite(ph.x) && Number.isFinite(ph.v) && Math.abs(ph.v) < 0.01, String(ph.v)); }
{ // une passe de quad, lame orientée à 30°, 2 m/s, pas d'image 1/60 s (même boucle que Quad.update) : le bourrelet se forme
  // à côté de la passe sans s'ébouler dedans ; >= 85 % des cellules à ±0,5 m de l'axe dégagées, masse conservée
  const f = new SnowField({ id: 'p', x0: 0, z0: 0, w: 6, d: 30 }), s = new Snow(); s.add(f); f.fill(0.2, DENS.powder);
  const m0 = s.total(), load = { kg: 0, rho: 100 }, a = -BLADE.maxAngle, d = 2 / 60; let rate = 0;
  for (let z = 1; z <= 28; z += d) {
    const beyond = windrowBeyond(rate, load.rho);
    const r = pushBlade(s, { x: 3, z, yaw: a, width: BLADE.width, down: true, side: spillSide(a, false), capacity: BLADE.capacity, steel: true, spillMax: spillPerM(a) * d, beyond, sweepLoose: windrowSweep(beyond) }, load);
    rate += (r.spilled / d - rate) * Math.min(1, 3 * d); f.relax();
  }
  while (f.active.size) f.relax();
  let ok = 0, n = 0;
  for (let iz = 30; iz < 270; iz++) for (let ix = 0; ix < f.nx; ix++) if (Math.abs((ix + 0.5) * 0.1 - 3) < 0.5) { n++; if (f.h[iz * f.nx + ix] < CLEAN) ok++; }
  assert.ok(ok / n >= 0.85, `passe dégagée à ${(ok / n * 100).toFixed(1)} %`);
  assert.ok(Math.abs(s.total() + load.kg - m0) < 0.05);
  assert.ok(windrowBeyond(0, 100) < windrowBeyond(100, 100)); // plus de débit, bourrelet plus large : posé plus loin
  assert.ok(spillPerM(BLADE.maxAngle) >= 2 * 26); } // 20 cm : la passe (26 kg/m) plus le bourrelet repris de la précédente
{ // sweepLoose : au-delà du bout qui déverse, la lame roule la neige meuble (bourrelet) mais laisse la neige en place
  const f = new SnowField({ id: 's', x0: 0, z0: 0, w: 6, d: 4 }), s = new Snow(); s.add(f); f.fill(0.2, DENS.powder);
  f.addAt(1.55, 1.05, 5, 100); // tas meuble 1,45 m à droite de l'axe x = 3 (bout droit à 2,25 m)
  const i = f.cellAt(1.55, 1.05), m0 = s.total(), load = { kg: 0, rho: 100 };
  pushBlade(s, { x: 3, z: 1.0, yaw: 0, width: 1.5, down: true, side: 1, capacity: 120, sweepLoose: 1 }, load);
  assert.ok(Math.abs(f.h[i] - 0.2) < 1e-6 && f.loose[i] === 0, 'neige en place gardée, meuble roulée ' + f.h[i]);
  assert.ok(Math.abs(s.total() + load.kg - m0) < 1e-6);
  const l2 = { kg: 0, rho: 100 }, f2 = new SnowField({ id: 's2', x0: 0, z0: 0, w: 6, d: 4 }), s2 = new Snow(); s2.add(f2); f2.fill(0.2, 100); f2.addAt(1.55, 1.05, 5, 100);
  pushBlade(s2, { x: 3, z: 1.0, yaw: 0, width: 1.5, down: true, side: -1, capacity: 120, sweepLoose: 1 }, l2); // débord à gauche : rien à droite
  assert.ok(f2.h[f2.cellAt(1.55, 1.05)] > 0.2 + 0.1); }
{ // petit parking 16 x 12 m, 20 cm : 16 passes de 1 m orientées à 30°, du milieu vers chaque bord (boucle de Quad.update) ;
  // le bourrelet est roulé de voie en voie puis sort du champ (relax hors bord -> tas au sol) : >= 95 % dégagé, masse conservée
  const f = new SnowField({ id: 'L', x0: 0, z0: 0, w: 16, d: 12 }), s = new Snow(); s.add(f); f.fill(0.2, DENS.powder);
  const m0 = s.total(), d = 2 / 60, A = BLADE.maxAngle;
  const pass = (x, a) => { const load = { kg: 0, rho: 100 }; let rate = 0;
    for (let z = -0.5; z <= 12.5; z += d) { const beyond = windrowBeyond(rate, load.rho);
      const r = pushBlade(s, { x, z, yaw: a, width: BLADE.width, down: true, side: spillSide(a, false), capacity: BLADE.capacity, steel: true, spillMax: spillPerM(a) * d, beyond, sweepLoose: windrowSweep(beyond) }, load);
      rate += (r.spilled / d - rate) * Math.min(1, 3 * d); f.relax(); assert.ok(load.kg <= BLADE.capacity * BLADE.slip, 'patine'); }
    throwLoad(s, load, x, 12.8, 1); while (f.active.size) f.relax(); };
  for (let k = 0; k < 8; k++) pass(Math.min(8.6 + k, 15.4), A);
  for (let k = 0; k < 8; k++) pass(Math.max(7.4 - k, 0.6), -A);
  assert.ok(f.cleanFraction() >= 0.95, `parking dégagé à ${(f.cleanFraction() * 100).toFixed(1)} %`);
  assert.ok(s.ground.length > 0 && Math.abs(s.total() - m0) < 0.05, 'masse ' + (s.total() - m0)); }

// --- Tâche 11 : météo et nuit ---
{ const w = bulletin(1, rng(2)); assert.ok(w.startCm >= 5 && w.startCm <= 30); assert.equal(w.cmPerHour, 2); assert.equal(w.wet, w.tempC > -1);
  assert.equal(rhoAt(-5), 100); assert.equal(rhoAt(-2), 100); assert.equal(rhoAt(-1), 400); assert.equal(rhoAt(3), 400); assert.equal(rhoAt(-1.5), 250);
  for (let k = 0; k < 50; k++) { const b = bulletin(k, rng(k)); assert.ok(b.startCm >= 5 && b.startCm <= 30 && b.rho === rhoAt(b.tempC)); }
  assert.equal(bulletin(3, rng(1)).early, true); assert.equal(bulletin(4, rng(1)).early, false); } // une nuit sur trois
{ const s = new Snow(); const f = new SnowField({ id: 'd', x0: 0, z0: 0, w: 3, d: 8 }); s.add(f); f.fill(0, 100);
  const n = new Night({ snow: s, layout: { houses: [{ drive: { x0: 0, z0: 0, w: 3, d: 8, mouth: { x0: 0, z0: 7, w: 3, d: 1 } }, zone: 'd' }], roads: [] } });
  n.municipalPass(); assert.ok(Math.abs(s.total() - 40 * 3) < 0.5);
  assert.equal(f.h[f.cellAt(1, 2)], 0); assert.ok(f.h[f.cellAt(1, 7.5)] > 0); } // seulement dans l'entrée
// verglas : neige tassée (>= 400) entre -1 et 1 °C seulement
{ const f = new SnowField({ id: 'v', x0: 0, z0: 0, w: 1, d: 1 }), s = new Snow(); s.add(f); f.fill(0.1, 100);
  f.rho[0] = 450; f.rho[1] = 400; f.rho[2] = 399; f.h[3] = 0; f.rho[3] = 450;
  assert.equal(iceOver(s, -3), 0); assert.equal(f.ice[0], 0);
  assert.equal(iceOver(s, 0.5), 2); assert.equal(f.ice[0], 1); assert.equal(f.ice[1], 1); assert.equal(f.ice[2], 0); assert.equal(f.ice[3], 0); }
// réputation : somme des étoiles - 2 x contrats sous 70 %, jamais sous 0
{ assert.equal(newRep(5, [{ p: 0.99, stars: 3 }, { p: 0.5, stars: 0 }]), 6);
  assert.equal(newRep(1, [{ p: 0.2, stars: 0 }, { p: 0.6, stars: 0 }]), 0); assert.equal(newRep(0, []), 0); }
// contrats : finishedAt au premier passage à 95 %, résultat figé à l'heure limite, fin anticipée au dépôt
{ const s = new Snow(), a = new SnowField({ id: 'a', x0: 0, z0: 0, w: 2, d: 2 }), b = new SnowField({ id: 'b', x0: 10, z0: 0, w: 2, d: 2 }); s.add(a); s.add(b);
  const layout = { houses: [], roads: [], sidewalks: [], zones: [{ id: 'a', rect: a }, { id: 'b', rect: b }], depot: { x0: 50, z0: 50, w: 10, d: 10 } };
  const n = new Night({ snow: s, layout, rand: rng(1) });
  const ca = { id: 'c-a', zoneIds: ['a'], name: 'A', deadline: 300, base: 50 }, cb = { id: 'c-b', zoneIds: ['b'], name: 'B', deadline: 420, base: 40 };
  n.begin([ca, cb], { startCm: 10, cmPerHour: 0, tempC: -5, rho: 100, early: false });
  assert.ok(Math.abs(a.h[0] - 0.1) < 1e-6);                 // champs remplis par le bulletin
  n.realSecPerMin = 1; n.update(10);                         // 4 h 10
  a.h.fill(0); n.update(10);                                  // A propre à 4 h 20
  assert.equal(ca.finishedAt, 260); n.update(1); assert.equal(ca.finishedAt, 260);
  a.h.fill(0.1); n.update(50); assert.ok(ca.result && ca.result.p === 0, 'figé à 5 h 00 sur l\'état sale'); a.h.fill(0); n.update(1);
  assert.equal(ca.result.p, 0);                               // reste figé après l'heure limite
  n.penalize('car', 11, 1); assert.equal(cb.pen, 10);         // contrat le plus proche (A est figé)
  b.h.fill(0); n.update(1, { x: 0, z: 0 }); assert.ok(!n.report, 'hors du dépôt');
  n.update(1, { x: 55, z: 55 }); assert.ok(!n.report, 'A figé sous 95 % : pas de fin anticipée');
  const r = n.end(); assert.equal(r.rows.length, 2); assert.equal(r.rows[1].penalties, 10); assert.equal(r.rows[1].pay, 48 - 10); // 40 x 1,2 (fini tôt) - 10
  assert.equal(r.total, r.rows[0].pay + r.rows[1].pay); assert.equal(n.end(), r); }
{ const s = new Snow(), a = new SnowField({ id: 'a', x0: 0, z0: 0, w: 2, d: 2 }); s.add(a);
  const n = new Night({ snow: s, layout: { houses: [], roads: [], sidewalks: [], zones: [{ id: 'a', rect: a }], depot: { x0: 50, z0: 50, w: 10, d: 10 } } });
  const c = { id: 'c-a', zoneIds: ['a'], name: 'A', deadline: 420, base: 50 }; let got = null; n.hooks.onEnd = (rep) => { got = rep; };
  n.begin([c], { startCm: 10, cmPerHour: 2, tempC: -5, rho: 100 }); a.h.fill(0); n.update(0.1, { x: 55, z: 55 });
  assert.ok(n.report && got === n.report && n.report.rows[0].stars === 3, 'fin anticipée au dépôt, contrats finis'); }
// chute de neige pendant la nuit (bornée par image, rattrapée avant l'évaluation) et sel qui fond le verglas en 2 minutes
{ const s = new Snow(), a = new SnowField({ id: 'a', x0: 0, z0: 0, w: 4, d: 4 }); s.add(a);
  const n = new Night({ snow: s, layout: { houses: [], roads: [], sidewalks: [], zones: [], depot: { x0: 50, z0: 50, w: 1, d: 1 } } });
  n.begin([], { startCm: 5, cmPerHour: 2, tempC: -5, rho: 100 }); n.realSecPerMin = 1;
  for (let k = 0; k < 60; k++) n.update(1);                   // une heure de jeu
  assert.ok(Math.abs(a.h[0] - 0.07) < 0.003, 'h ' + a.h[0]);
  a.ice.fill(1); n.salt(2, 2); n.update(1);                   // 1 min : pas encore fondu
  assert.equal(a.ice[a.cellAt(2, 2)], 1); n.update(1.5);
  assert.equal(a.ice[a.cellAt(2, 2)], 0); assert.equal(a.ice[a.cellAt(3.7, 3.5)], 0); assert.equal(a.ice[a.cellAt(3.95, 3.95)], 1); // rayon 2,52 m (20 m²)
  a.ice.fill(1); n.salt(0.2, 0.2); n.update(2.5); assert.equal(a.ice[a.cellAt(3.9, 3.9)], 1); }
// piétons à 6 h : ils tassent les trottoirs
{ const s = new Snow(), w = new SnowField({ id: 'sidewalk-1', x0: 0, z0: 0, w: 2, d: 30 }); s.add(w);
  const n = new Night({ snow: s, layout: { houses: [], roads: [], sidewalks: [{ x0: 0, z0: 0, w: 2, d: 30 }], zones: [], depot: { x0: 50, z0: 50, w: 1, d: 1 } } });
  let peds = null; n.hooks.onPeds = (p) => { peds = p; };
  n.begin([], { startCm: 10, cmPerHour: 0, tempC: -5, rho: 100 }); n.realSecPerMin = 0.05;
  for (let k = 0; k < 120; k++) n.update(0.05);               // 6 h 00 dépassé
  assert.ok(peds && peds.length >= 1); n.realSecPerMin = 5;
  for (let k = 0; k < 600; k++) n.update(1 / 60);
  let packed = 0; for (let i = 0; i < w.rho.length; i++) if (w.rho[i] > 150) packed++;
  assert.ok(packed > 50, 'cellules tassées ' + packed); }
// rattrapage de chute sans markAll : seules les cellules qui passent un seuil visible sont marquées
{ const f = new SnowField({ id: 'm', x0: 0, z0: 0, w: 16, d: 1 }); f.fill(0, 100); f.h[5] = 0.009; f.dirty.clear();
  f.snow(0.1, 2, 100, false); assert.equal(f.dirty.size, 1); f.snow(0.1, 2, 100); assert.equal(f.dirty.size, f.chunksX * f.chunksZ); }
// rattrapages forcés répétés (progress chaque minute) : dès 0,2 cm cumulés, le champ du contrat est marqué en entier
{ const s = new Snow(), a = new SnowField({ id: 'a', x0: 0, z0: 0, w: 2, d: 2 }); s.add(a);
  const n = new Night({ snow: s, layout: { houses: [], roads: [], sidewalks: [], zones: [{ id: 'a', rect: a }], depot: { x0: 50, z0: 50, w: 1, d: 1 } } });
  const c = { id: 'c-a', zoneIds: ['a'], name: 'A', deadline: 420, base: 50 };
  n.begin([c], { startCm: 10, cmPerHour: 2, tempC: -5, rho: 100 }); a.dirty.clear();
  for (let k = 0; k < 5; k++) { n.clock.update(n.clock.k); n.flush(c); }      // 5 min = 0,17 cm : pas encore
  assert.equal(a.dirty.size, 0);
  n.clock.update(n.clock.k); n.flush(c); assert.equal(a.dirty.size, a.chunksX * a.chunksZ); // 6 min = 0,2 cm
  assert.ok(Math.abs(a.h[0] - 0.102) < 1e-4); }
// --- Tâche 12 : sauvegarde et achats ---
const mem = () => { const s = {}; return { getItem: (k) => s[k] ?? null, setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } }; };
{ const m = mem();
  assert.ok(!exists(m)); assert.deepEqual(load(m), fresh());
  m.setItem('deneigeur.save.v1', '{pas du json'); assert.equal(load(m).night, 1); assert.ok(!exists(m));
  m.setItem('deneigeur.save.v1', JSON.stringify({ v: 0, money: 999 })); assert.equal(load(m).money, 0); assert.ok(!exists(m)); }
{ const s = load(mem()); s.money = 100; assert.ok(buy(s, 'shovel:large', 60)); assert.equal(s.money, 40); assert.ok(!buy(s, 'shovel:large', 60)); assert.ok(!buy(s, 'blower', 600)); }
{ const st = mem(), s = load(st); s.money = 77; persist(st, s); assert.equal(load(st).money, 77); assert.ok(exists(st)); }
// stockage indisponible (localStorage qui lève) : partie neuve, persist ne plante pas
{ const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(load(bad).night, 1); assert.equal(persist(bad, fresh()), false); assert.equal(load(null).money, 0); }
// une sauvegarde v1 incomplète garde les champs par défaut ; fresh() renvoie un objet neuf à chaque appel
{ const m = mem(); m.setItem('deneigeur.save.v1', JSON.stringify({ v: 1, money: 5 })); const s = load(m); assert.equal(s.money, 5); assert.deepEqual(s.owned, ['shovel:base']);
  s.owned.push('gear:boots'); assert.deepEqual(fresh().owned, ['shovel:base']); }
// prix du catalogue, consommables (spend), plein d'essence, outils des contrats
{ assert.equal(CATALOG.blower, 600); assert.equal(CATALOG.quad, 2400); assert.equal(CATALOG.fuelPerL, 2); assert.equal(CATALOG.SHOVELS.large.price, 60); assert.equal(CATALOG.GEAR.salt, 10);
  const s = fresh(); s.money = 15; assert.ok(spend(s, 10)); assert.equal(s.money, 5); assert.ok(!spend(s, 10)); assert.equal(s.money, 5);
  assert.equal(fuelCost(0.5, 2), 3); assert.equal(fuelCost(2, 2), 0);
  assert.deepEqual(toolsOf(s), ['pelle']); s.owned.push('quad'); assert.deepEqual(toolsOf(s), ['pelle', 'quad']); s.owned.push('blower'); assert.deepEqual(toolsOf(s), ['pelle', 'fraise', 'quad']); }
// champs de mauvais type dans une sauvegarde v1 : valeurs saines, aucun plantage à l'usage
{ const m = mem(); m.setItem('deneigeur.save.v1', JSON.stringify({ v: 1, owned: null, fuel: null, damaged: 'x', money: 'abc', night: null, rep: -3, salt: '2', shovel: 'toString', upgrades: [1] }));
  const s = load(m);
  assert.deepEqual(s.owned, ['shovel:base']); assert.deepEqual(s.fuel, { blower: 0 }); assert.deepEqual(s.damaged, []); assert.equal(s.money, 0);
  assert.equal(s.night, 1); assert.equal(s.rep, 0); assert.equal(s.salt, 0); assert.equal(s.shovel, 'base'); assert.deepEqual(s.upgrades, {});
  assert.deepEqual(toolsOf(s), ['pelle']); s.money = 100; assert.ok(buy(s, 'gear:boots', 50)); assert.equal(fuelCost(s.fuel.blower, 2), 4);
  m.setItem('deneigeur.save.v1', JSON.stringify({ v: 1, owned: ['shovel:large', 3], shovel: 'pusher', fuel: { blower: 99 }, damaged: ['quad', 'tank'], night: 4.7 }));
  const t = load(m); assert.deepEqual(t.owned, ['shovel:base', 'shovel:large']); assert.equal(t.shovel, 'base'); assert.equal(t.fuel.blower, 4); assert.deepEqual(t.damaged, ['quad']); assert.equal(t.night, 4); }
// touche R : place libre (déjà libre = inchangée ; dans une maison = dehors ; chaussée préférée)
{ const house = [{ x: 0, z: 0, hw: 5, hd: 4, yaw: 0 }], car = { x: 20, z: 0, hw: 1, hd: 2.5, yaw: 0.3 };
  assert.ok(!overlaps(car, house)); assert.deepEqual(freeSpot(car, house), [20, 0]);
  const inside = { ...car, x: 1, z: 0.5 }; assert.ok(overlaps(inside, house));
  const [x, z] = freeSpot(inside, house); assert.ok(!overlaps({ ...inside, x, z }, house));
  const [rx] = freeSpot(inside, house, (px) => px < -9); assert.ok(rx < -9);
  const w = { x: 4.9, z: 0, hw: 0.3, hd: 0.3, yaw: 0 }, p = freeSpot(w, house); assert.ok(!overlaps({ ...w, x: p[0], z: p[1] }, house));
  // enlisé, sans obstacle : ok refuse la place actuelle (> 2 m exigés), la place rendue est ailleurs
  const [sx, sz] = freeSpot(car, house, (px, pz) => Math.hypot(px - 20, pz) > 2); assert.ok(Math.hypot(sx - 20, sz) > 2 && !overlaps({ ...car, x: sx, z: sz }, house)); }
// neige qui tombe : une zone dégagée à 4 h reste propre à l'heure limite (bonus d'avance) ; un champ jamais touché reste à 0 %
{ const s = new Snow(), f = new SnowField({ id: 'a', x0: 0, z0: 0, w: 3, d: 8, kind: 'drive' }); s.add(f);
  const lay = { zones: [{ id: 'a', rect: { x0: 0, z0: 0, w: 3, d: 8 } }], houses: [], roads: [], depot: { x0: 500, z0: 500, w: 1, d: 1 } };
  const wx = { startCm: 15, cmPerHour: 2, tempC: -5, rho: 100, early: false };
  let n = new Night({ snow: s, layout: lay, rand: () => 0.5 }), k = { id: 'c', zoneIds: ['a'], name: 'A', deadline: 390, base: 30 };
  n.begin([k], wx); f.h.fill(0); f.markAll();
  while (!n.report) n.update(1 / 60, null);
  assert.equal(n.report.rows[0].p, 1); assert.ok(k.finishedAt <= 242); assert.equal(n.report.rows[0].pay, 36); // 30 € + 20 % d'avance
  n = new Night({ snow: s, layout: lay, rand: () => 0.5 }); k = { id: 'c', zoneIds: ['a'], name: 'A', deadline: 420, base: 30 };
  n.begin([k], { ...wx, startCm: 5 }); while (!n.report) n.update(1 / 60, null);
  assert.equal(n.report.rows[0].p, 0); }
console.log('logic OK');
