/* Déneigeur : scène de nuit, joueur à pied, pick-up du dépôt, fraise à neige et quad (F pour monter ou descendre), boucle de jeu.
   J : jerrican du plateau dans la fraise (à portée des deux). X : sel. La nuit (Night) est la seule source de l'heure de jeu.
   Boucle de partie : titre (Continuer / Nouvelle partie) -> tableau des contrats -> nuit -> bilan (sauvegarde) -> garage -> tableau...
   mode : 'title' | 'board' | 'night' | 'pause' | 'map' | 'report' | 'garage' ; hors 'night', le monde est dessiné mais ne bouge pas. */
import * as THREE from 'three';
import '../../../assets/building-kit.js';
import { clamp, rng, wrapPi } from './core/util.js';
import { inp, poll, endFrame, pressed } from './core/input.js';
import { save as S, storage, persist, exists, fresh, load } from './core/save.js';
import { toolsOf } from './gameplay/economy.js';
import { Hud } from './ui/Hud.js';
import { hide, title, pause as pauseScreen, sinceOpen } from './ui/screen.js';
import { board } from './ui/Board.js';
import { report as reportScreen } from './ui/Report.js';
import { garage as garageScreen, upgradesOf, VEHICLE_NAME } from './ui/Garage.js';
import { mapView } from './ui/MapView.js';
import { Snow } from './snow/SnowField.js';
import { pushBlade, throwLoad } from './snow/blade.js';
import { SnowMesh } from './snow/SnowMesh.js';
import { makeFlakes } from './snow/flakes.js';
import { buildQuartier } from './world/Quartier.js';
import { makeSky } from './world/sky.js';
import { Walker } from './player/Walker.js';
import { Stamina } from './gameplay/rules.js';
import { Cams } from './camera/cams.js';
import { Pickup } from './vehicles/Pickup.js';
import { Seat } from './vehicles/seat.js';
import { SnowBlower } from './vehicles/SnowBlower.js';
import { Quad } from './vehicles/Quad.js';
import { refuel, blowerSpec } from './vehicles/blowerLogic.js';
import { LAYOUT } from './world/layout.js';
import { collide, freeSpot, overlaps } from './world/solids.js';
import { makeLife } from './world/life.js';
import { bulletin } from './gameplay/weather.js';
import { Night } from './gameplay/Night.js';
import { drawContracts } from './gameplay/contracts.js';
import { createAudio } from './audio/audio.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;

const NIGHT = 0x0b1230;
const scene = new THREE.Scene();
scene.background = new THREE.Color(NIGHT);
scene.fog = new THREE.Fog(NIGHT, 40, 220);
const hemi = new THREE.HemisphereLight(0x3a4a8a, 0x1a1f2e, 0.9); scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9db4ff, 0.6); moon.position.set(-30, 60, 20); scene.add(moon);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
const _gr = new THREE.Vector3(), _gl = new THREE.Vector3();

const K = globalThis.BuildingKit(THREE);

// les champs de neige du quartier existent avant SnowMesh (un morceau GPU par 8 x 8 m créé à la construction)
const snow = new Snow(), quartier = buildQuartier(scene, K, snow), snowMesh = new SnowMesh(scene, snow), flakes = makeFlakes(scene, camera);
const sky = makeSky(scene, camera, hemi);
quartier.setNight(1);
// pick-up garé au dépôt, nez vers la rue principale ; le joueur part à pied à côté de la portière conducteur
// la fraise et le quad n'existent dans le jeu (visibles, montables, obstacles) qu'une fois achetés : vehicles = véhicules possédés
const pickup = new Pickup(scene), blower = new SnowBlower(scene, snow), quad = new Quad(scene, snow), vehicles = [pickup], seat = new Seat();
const ST = LAYOUT.stairs; // les véhicules ne montent pas l'escalier de l'église (le joueur à pied, si)
const carSolids = [...quartier.solids, { x: ST.x0 + ST.n * ST.tread / 2, z: ST.z0 + ST.w / 2, hw: ST.n * ST.tread / 2, hd: ST.w / 2, yaw: 0 }];
const walker = new Walker(scene, snow, S), cams = new Cams(camera); // équipement et sel lus dans la sauvegarde
walker.cars = quartier.cars; walker.doors = quartier.doors;
// obstacles : chaque véhicule bute sur les autres ; une fraise rangée sur le plateau n'a plus de caisse au sol
function refreshSolids() {
  const free = vehicles.filter((v) => !v.stowed);
  walker.solids = [...quartier.solids, ...free.map((v) => v.solid)];
  for (const v of vehicles) v.solids = [...carSolids, ...free.filter((k) => k !== v).map((k) => k.solid)];
}
refreshSolids(); let stowedWas = blower.stowed;
pickup.groundAt = blower.groundAt = quad.groundAt = (x, z) => walker.groundY(x, z); // hors champ : sol (parvis) ou 0
for (const v of [blower, quad]) { v.penaltyAt = (x, z, r) => walker.penaltyAt(x, z, r); v.onPenalty = (kind) => walker.onPenalty(kind); }
const penalties = { car: 0, door: 0 };
// --- la nuit : bulletin, contrats, événements (life.js les dessine) ---
const life = makeLife(scene, snow), rand = rng(Date.now() | 0);
const night = new Night({ snow, layout: LAYOUT, rand, hooks: { ...life.hooks, onEnd: (r) => { __snow.report = r; } } });
const hud = new Hud(), guideLine = window.GameSettings?.ground(THREE, scene), RECTS = new Map(LAYOUT.zones.map((z) => [z.id, z.rect]));
const audio = createAudio(); // le contexte audio naît au premier geste du joueur
let mode = 'title', guide = null, offer = null, repBefore = 0, mine = false, resetCool = 0; // mine : sauvegarde de cette partie déjà écrite ou reprise

// tout le monde au dépôt, à pied ; véhicules possédés garés à leur place, améliorations et essence de la sauvegarde
function atDepot() {
  if (seat.vehicle) { seat.vehicle.exit(); seat.vehicle = null; seat.current = 'walker'; }
  if (blower.stowed) { blower.stowed = false; pickup.bed.delete('blower'); pickup.cargo = null; }
  pickup.rampT = -1; pickup.ramp.visible = false; pickup.cargo = null; // nuit finie pendant la rampe : sinon le pick-up reste bloqué (rampT >= 0)
  blower.stalled = blower.auger = false;
  walker.group.visible = true; walker.hideHead = false; walker.carry.kg = 0; walker._prev = null; walker.stamina = new Stamina(); walker.refused = 0;
  walker.position.set(LAYOUT.depot.x0 + 15, 0, 286.5); walker.yaw = cams.yaw = Math.PI / 2;
  pickup.place(LAYOUT.depot.x0 + 17, 286, Math.PI);
  blower.place(LAYOUT.depot.x0 + 17, 293.5, Math.PI); // derrière le hayon, hors de portée du chargement (2,5 m)
  quad.place(LAYOUT.depot.x0 + 24, 282.5, Math.PI);    // à droite du pick-up, nez vers la rue ; caméra (5,4 m derrière) hors du hangar (z 289-299)
  pickup.bed.add('jerrycan'); // le dépôt remplit le jerrican chaque nuit
  vehicles.length = 0; vehicles.push(pickup);
  for (const v of [blower, quad]) { const own = S.owned.includes(v.id); v.group.visible = own; if (own) vehicles.push(v); Object.assign(v.upgrades, upgradesOf(S, v.id)); }
  blower.fuel = S.fuel.blower;
  // un véhicule non réparé roule à 70 % de sa vitesse de pointe
  for (const v of [pickup, quad]) { v.vmax0 ??= v.phys.vmax; v.phys.vmax = v.vmax0 * (S.damaged.includes(v.id) ? 0.7 : 1); v.hits = 0; }
  walker.setTool(S.shovel); refreshSolids(); stowedWas = false;
}
const draw = () => { const weather = bulletin(S.night, rand); return { weather, contracts: drawContracts(LAYOUT.zones, { rep: S.rep, tools: toolsOf(S), weather }, rand) }; };
function toBoard() {
  mode = 'board'; hud.show(false); offer = draw();
  board({ S, start: (picked) => startNight(picked), garage: toGarage }, offer.weather, offer.contracts);
}
// sans argument (console) : tous les contrats proposés sont acceptés
function startNight(picked) {
  offer ??= draw();
  atDepot(); night.rep = repBefore = S.rep; life.hooks.onPeds([]);
  for (const d of [life.plow, life.bus]) if (d) { d.pts = null; d.obj.visible = false; } // tournée en cours à la fin de la nuit : ne reprend pas à 4 h
  night.begin(picked || offer.contracts, offer.weather); offer = null; guide = null;
  hide(); hud.show(true); mode = 'night';
  return night;
}
function endNight(r) {
  const damaged = [pickup, quad].filter((v) => v.hits > 0 && vehicles.includes(v)).map((v) => v.id);
  for (const id of damaged) if (!S.damaged.includes(id)) S.damaged.push(id);
  const n = S.night;
  S.money += r.total; S.rep = r.rep; S.night++; S.fuel.blower = blower.fuel;
  const saved = save();
  mode = 'report'; hud.show(false); document.exitPointerLock?.();
  reportScreen({ S, saved, garage: toGarage }, r, { night: n, repBefore, damaged: damaged.map((id) => VEHICLE_NAME[id]) });
}
const save = () => (mine = persist(storage, S));
function toGarage() { mode = 'garage'; garageScreen({ S, persist: save, next: toBoard }); }
const lockCanvas = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* refusé hors geste */ } };
function pause() { mode = 'pause'; document.exitPointerLock?.(); pauseScreen({ resume: () => { resume(); lockCanvas(); }, endNow: () => endNight(night.end()), quit: () => { if (mine) save(); toTitle(); } }); } // en quittant : sacs de sel utilisés gardés
function resume() { mode = 'night'; hide(); }
function openMap() {
  mode = 'map'; document.exitPointerLock?.();
  const p = at(), yaw = seat.vehicle ? seat.vehicle.phys.yaw : walker.yaw;
  mapView({ layout: LAYOUT, contracts: night.contracts, rects: RECTS, player: { x: p.x, z: p.z, yaw }, guide,
    choose: (k) => { guide = k; resume(); lockCanvas(); }, close: () => { resume(); lockCanvas(); } });
}
function toTitle() {
  mode = 'title'; hud.show(false); audio.stop();
  title({ S: load(storage), hasSave: exists(storage), cont: () => { replaceSave(load(storage)); mine = true; toBoard(); }, newGame: () => { mine = false; replaceSave(fresh()); toBoard(); } });
  // S remplacé en place (les modules gardent sa référence) ; Continuer relit le stockage : une Nouvelle partie abandonnée ne l'écrase pas.
  // Le verglas (non sauvegardé) repart de zéro, comme après un chargement de la page : il ne passe pas d'une partie à l'autre.
  function replaceSave(v) { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, v); for (const f of snow.fields) { f.ice.fill(0); f.markAll(); } }
}
window.__pauseGame = () => { if (mode === 'night') pause(); else if (mode === 'pause' && sinceOpen() > 300) { resume(); lockCanvas(); } }; // bouton ❚❚ de hud-kit

// R : replacer. En véhicule : arrêté, remis à plat, et déplacé à la place libre la plus proche (chaussée préférée) s'il touche un
// obstacle ou s'il est enlisé (stuck) ; sinon il reste où il est. À pied : sorti de tout obstacle. Une fois par seconde au plus.
const onRoad = (x, z) => [...LAYOUT.roads, LAYOUT.depot].some((r) => x >= r.x0 && x < r.x0 + r.w && z >= r.z0 && z < r.z0 + r.d);
function reset() {
  if (resetCool > 0) return; resetCool = 1;
  const v = seat.vehicle;
  if (v) {
    const s = { ...v.solid, x: v.phys.x, z: v.phys.z, yaw: v.phys.yaw };
    const [x, z] = (overlaps(s, v.solids) || v.stuck ? freeSpot(s, v.solids, (px, pz) => onRoad(px, pz) && (!v.stuck || Math.hypot(px - s.x, pz - s.z) > 2)) : null) || [s.x, s.z];
    v.place(x, z, v.phys.yaw); v.tilt.rotation.x = v.tilt.rotation.z = 0; v.stuck = false;
  } else {
    const p = walker.position, [x, z] = freeSpot({ x: p.x, z: p.z, hw: 0.3, hd: 0.3, yaw: 0 }, walker.solids) || [p.x, p.z];
    p.x = x; p.z = z; p.y = walker.groundY(x, z); walker.speed = 0; walker._prev = null; // _prev : pas de raclage de l'ancienne place à la nouvelle
  }
}

// contrat non figé le plus proche du point (distance à sa zone la plus proche)
function nearest(x, z) {
  let best = null;
  for (const k of night.contracts) {
    if (k.result) continue;
    for (const id of k.zoneIds) {
      const r = RECTS.get(id), d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x0 - r.w), Math.max(r.z0 - z, 0, z - r.z0 - r.d));
      if (!best || d < best.d) best = { k, d };
    }
  }
  return best;
}
// guidage vers la zone choisie sur la carte (sinon le contrat le plus proche pas encore fini) : flèche en haut et chevrons au sol
function guideTo(p, near) {
  const k = guide && !guide.result ? guide : near && (near.k.p || 0) < 0.95 ? near.k : null;
  let r = null, bd = Infinity;
  if (k) for (const id of k.zoneIds) { const q = RECTS.get(id), d = Math.hypot(q.x0 + q.w / 2 - p.x, q.z0 + q.d / 2 - p.z); if (d < bd) { bd = d; r = q; } }
  const inside = r && p.x > r.x0 - 1 && p.x < r.x0 + r.w + 1 && p.z > r.z0 - 1 && p.z < r.z0 + r.d + 1;
  if (!r || inside) { window.GameSettings?.arrow(null); guideLine?.update(null); return; }
  const tx = r.x0 + r.w / 2, tz = r.z0 + r.d / 2, heading = seat.vehicle ? seat.vehicle.phys.yaw : cams.yaw;
  window.GameSettings?.arrow(wrapPi(Math.atan2(tx - p.x, tz - p.z) - heading), `${k.name} · ${Math.round(bd)} m`);
  guideLine?.update([{ x: p.x, y: walker.groundY(p.x, p.z), z: p.z }, { x: tx, y: walker.groundY(tx, tz), z: tz }], performance.now() / 1000);
}
const at = () => (seat.vehicle ? seat.vehicle.phys : walker.position); // joueur, ou son véhicule
// pénalité : au contrat le plus proche du joueur (le tas tombe à quelques mètres de lui)
walker.onPenalty = (kind) => { penalties[kind]++; const p = at(); night.penalize(kind, p.x, p.z); };
walker.onSalt = (x, z) => night.salt(x, z);
let spread = 0; // saleuse du quad : un disque de sel de 1,3 m de rayon tous les 2 m roulés
const __snow = globalThis.__snow = {
  audio, snow, snowMesh, quartier, pushBlade, throwLoad, walker, cams, penalties, pickup, blower, quad, seat, vehicles,
  night, life, startNight, report: null, S, endNight: () => endNight(night.end()), mode: () => mode,
  hold: null, // touches maintenues pour les essais : { throttle, brake, steer, hand }
  refuel: () => refuel(blower, pickup, walker.position), // J
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt, i === n - 1); }, // jeu avancé à la main (panneau caché)
  tp(x, z, yaw = 0) { pickup.place(x, z, yaw); },
  toggle() { return toggleSeat(); },
  // sillon droit de z0 à z1 (m), lame de 2,4 m, bourrelet à droite
  line(x = 170, z0 = 21, z1 = 48, width = 2.4) { // par défaut : sur le parking du supermarché
    const load = { kg: 0, rho: 100 };
    for (let z = z0; z <= z1; z += 0.05) pushBlade(snow, { x, z, yaw: 0, width, down: true, side: 1, capacity: 150, steel: false }, load);
    return load;
  },
};

export const game = { scene, camera, renderer, K, snow, quartier, walker, cams, night, minutes: 240 }; // minutes : heure de jeu (night.minutes)

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// F : monter, descendre ; le joueur est caché et ne bouge pas tant qu'il est assis
function toggleSeat() {
  const act = seat.tryToggle(walker, vehicles);
  // à la fraise, le joueur reste visible, debout aux mancherons
  if (act === 'enter') { walker.group.visible = seat.vehicle === blower; walker.marker.visible = false; cams.enterCar(seat.vehicle); }
  else if (act === 'exit' || act === 'load') { walker.group.visible = true; walker.hideHead = false; walker._prev = null; cams.yaw = walker.yaw; } // _prev : pas de raclage depuis l'ancienne place
  return act;
}

// sons : moteur du véhicule conduit, raclage (pelle, lame du quad), coup de pelle jeté (charge qui tombe à 0), vent selon la neige
let kgWas = 0;
function sounds(car, dt) {
  const v = car ? Math.abs(car.phys.v) : 0;
  if (car === blower) audio.engine(blower.on && !blower.stalled ? 'blower' : null, blower.rpm / 3400, blower.kgPerSec / 25);
  else if (car) audio.engine(car.id, v / (car.phys.vmax || 10), car === quad && quad.blade.height < 0.02 ? 0.5 : 0);
  else audio.engine(null);
  const sc = car === quad ? quad.blade.height < 0.02 && v > 0.3 : !car && walker.down && walker.speed > 0.1;
  audio.scrape(sc, car === quad ? v : walker.speed);
  const kg = walker.carry.kg; if (!car && kgWas - kg > 0.5 && walker.throwT >= 0) audio.shovel(kgWas - kg); kgWas = kg;
  audio.wind(Math.min(1, (night.weather?.cmPerHour ?? 0) / 4));
}

function tick(dt, render = true) {
  poll();
  // Échap / Tab : pause (une Échap réelle et celle injectée par la perte du pointeur ne basculent qu'une fois : 300 ms d'écart)
  const esc = pressed('Escape') && sinceOpen() > 300; // Tab ne ferme pas un menu : il y déplace le focus
  if (mode === 'night') { if (esc || pressed('Tab')) pause(); else if (pressed('KeyM')) openMap(); else if (pressed('KeyR')) reset(); }
  else if (mode === 'pause' && esc) resume();
  else if (mode === 'map' && (esc || (pressed('KeyM') && sinceOpen() > 300))) resume();
  resetCool = Math.max(0, resetCool - dt);
  audio.pause(mode !== 'night');
  if (mode !== 'night') { // menus : le monde est figé, la neige et le ciel continuent d'être dessinés
    if (!seat.vehicle) cams.follow(walker, dt);
    guideLine?.update(null); snowMesh.update(); flakes.update(dt, 2); sky.update(game.minutes);
    if (render) renderer.render(scene, camera);
    return endFrame();
  }
  if (__snow.hold) Object.assign(inp, __snow.hold);
  if (pressed('KeyC')) cams.toggle();
  if (pressed('KeyF')) toggleSeat();
  const car = seat.vehicle;
  if (car && pressed('KeyL')) car.lights = !car.lights;
  if (pressed('KeyJ')) refuel(blower, pickup, walker.position);
  for (const v of vehicles) v.update(dt, v === car ? inp : null, snow);
  if (blower.stowed !== stowedWas) { stowedWas = blower.stowed; refreshSolids(); }
  if (car === blower) { // l'opérateur suit la fraise, mains sur les poignées
    [walker.position.x, walker.position.z] = collide(...blower.operatorSpot(), 0.3, walker.solids); walker.position.y = walker.groundY(walker.position.x, walker.position.z);
    walker.yaw = blower.phys.yaw; walker.hideHead = cams.mode === 'first'; walker.operate(dt, Math.abs(blower.phys.v), ...blower.grips(_gr, _gl));
  }
  if (car) cams.followCar(car, dt);
  else { cams.look(walker); walker.lookYaw = cams.yaw; walker.lookPitch = cams.pitch; walker.update(dt); cams.follow(walker, dt); }
  const done = night.update(dt, at()); game.minutes = night.minutes; blower.gameH = 1 / (60 * night.realSecPerMin);
  if (quad.upgrades.spreader && car === quad) {
    const ph = quad.phys; spread += Math.abs(ph.v) * dt;
    if (spread > 2) { spread = 0; night.salt(ph.x - Math.sin(ph.yaw) * 1.3, ph.z - Math.cos(ph.yaw) * 1.3, 1.3); }
  }
  life.update(dt);
  sounds(car, dt);
  snowMesh.update(); flakes.update(dt, 2); sky.update(game.minutes);
  const p = at(), near = nearest(p.x, p.z);
  guideTo(p, near);
  hud.update(dt, { minutes: night.minutes, night: S.night, walker, seated: !!car, blower: vehicles.includes(blower) ? blower : null, tank: blowerSpec(blower.upgrades).tank,
    near, penalties: night.contracts.reduce((t, k) => t + (k.pen || 0), 0) });
  if (render) renderer.render(scene, camera);
  endFrame();
  if (done) endNight(done);
}

await Promise.all([walker.load(), pickup.load(), blower.load(), quad.load()]);
atDepot();
window.GameLoader?.ready();
toTitle();
let last = performance.now();
renderer.setAnimationLoop((now) => { tick(clamp((now - last) / 1000, 0, 0.05)); last = now; });
