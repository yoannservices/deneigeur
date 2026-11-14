// Rendu du quartier (LAYOUT) : sol enneigé, chaussées, bâtiments du kit (K.lodCity), escalier et terrasse de l'église,
// lampadaires émissifs, enseignes, dépôt, voitures garées (npc/car-*.glb) et un champ de neige par zone et par trottoir.
import * as THREE from 'three';
import { loadGLB, bakeParts } from '../../../../assets/glb.js';
import { SnowField, DENS } from '../snow/SnowField.js';
import { rng } from '../core/util.js';
import { LAYOUT } from './layout.js';
import { solidsFrom } from './solids.js';

const START_DEPTH = 0.2; // remplie de nouveau par Night.begin selon le bulletin météo
const TINTS = ['#f2e6d0', '#e8d7c0', '#d9c6a8', '#efe2cf', '#cfd6d9', '#e6cdb8'];
const CAR_COLORS = [0x8a1f24, 0x2b4a7a, 0xd8d8d4, 0x2d3034, 0x5d6b4a, 0x9aa1a8, 0x6b3f2a];
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });

export function buildQuartier(scene, K, snow) {
  const rand = rng(61), L = LAYOUT;

  // --- sol : neige décorative des jardins ; sous chaque champ un revêtement visible une fois dégagé ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), std(0xdde5f0, { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(L.size / 2, 0, L.size / 2); ground.receiveShadow = true; scene.add(ground);
  const pave = K.acc(), top = (k, r, y = 0.005) => pave.box(k, r.x0, y - 0.001, r.z0, r.x0 + r.w, y, r.z0 + r.d, 4, ['-y', '+x', '-x', '+z', '-z']);
  for (const r of L.roads) top('road', r);
  for (const z of L.zones) if (z.kind !== 'stairs' && !z.slope) top(z.kind === 'drive' || z.kind === 'parking' ? 'asphalt' : 'concrete', z.rect);
  // allée en pente : rampe (dessus en enrobé, flancs de pierre jusqu'au jardin) qui suit exactement baseY du champ
  for (const z of L.zones) if (z.slope) {
    const r = z.rect, y = (x, q) => (z.y || 0) + z.slope.dx * (x - r.x0) + z.slope.dz * (q - r.z0) + 0.005, V = (x, h, q) => new THREE.Vector3(x, h, q);
    const c = [[r.x0, r.z0], [r.x0 + r.w, r.z0], [r.x0 + r.w, r.z0 + r.d], [r.x0, r.z0 + r.d]];
    pave.quad('asphalt', ...c.map(([x, q]) => V(x, y(x, q), q)), [0, 0], [r.w / 4, 0], [r.w / 4, r.d / 4], [0, r.d / 4], V(0, 1, 0));
    for (let i = 0; i < 4; i++) {
      const [x0, q0] = c[i], [x1, q1] = c[(i + 1) % 4], out = V(q1 - q0, 0, x0 - x1); // normale extérieure (parcours anti-horaire vu d'en haut)
      if (y(x0, q0) + y(x1, q1) > 0.02) pave.quad('stone', V(x0, 0, q0), V(x1, 0, q1), V(x1, y(x1, q1), q1), V(x0, y(x0, q0), q0), [0, 0], [1, 0], [1, 1], [0, 1], out);
    }
  }
  // maison au sommet de la rampe : soubassement de pierre
  for (const h of L.houses) if (h.y) pave.box('stone', h.x - h.w / 2, 0, h.z - h.d / 2, h.x + h.w / 2, h.y, h.z + h.d / 2, 4, ['-y']);
  for (const r of L.sidewalks) top('concrete', r);
  // escalier de pierre (marches pleines) et terrasse de l'église au sommet
  const S = L.stairs, T = L.terrace;
  for (let k = 0; k < S.n; k++) pave.box('stone', S.x0 + k * S.tread, 0, S.z0, S.x0 + (k + 1) * S.tread, S.rise * (k + 1), S.z0 + S.w, 4, ['-y']);
  pave.box('stone', T.x0, 0, T.z0, T.x0 + T.w, T.y, T.z0 + T.d, 4, ['-y', '+y']);
  top('snowTop', T, T.y);
  const kitMats = K.materials({ style: 'stucco', roof: 'slate', roofColor: '#eef2f8' });
  scene.add(K.group(pave.geometries(), {
    road: std(0xa9b1bd), asphalt: std(0x3d4148), concrete: std(0x80858c), snowTop: std(0xe4ebf5), stone: kitMats.plinth, trim: kitMats.trim,
  }, { cast: false }));

  // --- bâtiments : une ville par zones de 120 m, un seul jeu de matériaux (lit et shop partagés pour setNight) ---
  const mats = { ...kitMats,
    wallWood: K.materials({ style: 'wood', wall: '#c99c6c' }).wall, wallStone: K.materials({ style: 'stone', wall: '#d8d0c0' }).wall,
    wallConc: K.materials({ style: 'concrete', wall: '#d4d6d8' }).wall, wallMetal: K.materials({ style: 'metal', wall: '#9aa3ab' }).wall };
  mats.roofFlat = mats.roofFlat.clone(); mats.roofFlat.color.set('#e4ebf3'); // neige sur les toits-terrasses
  const city = K.lodCity(120), base = { roof: 'gable', door: false, rand };
  for (const h of L.houses) {
    city.building(h.x, h.y, h.z, h.yaw, { ...base, w: h.w, d: h.d, h: 5.6, fh: 2.8, rise: Math.min(h.d * 0.42, 3.8), shutters: true, tint: TINTS[h.n % TINTS.length],
      openings: [{ face: '+z', s: h.garageS, w: 2.6, type: 'garage' }, { face: '+z', s: h.doorS, w: 1, type: 'door' }] }, h.n % 3 === 0 ? { wall: 'wallWood' } : null);
  }
  const OPTS = {
    shop: (b) => ({ fh: 2.8, gfh: 4, shop: ['+z'], rise: 3, awningColor: b.name === 'pharmacie' ? '#2f8a4a' : b.name === 'café' ? '#7a2e2e' : '#b3262e' }),
    school: () => ({ fh: 3.6, rise: 3.5, openings: [{ face: '+z', s: 0, w: 1.8, type: 'entry' }] }),
    church: () => ({ fh: 9.5, rise: 4.5, door: '-x', doorW: 1.6, doorType: 'door', win: [1.1, 3.4], chimney: false, quoins: true, attic: false }),
    tower: () => ({ fh: 4.25, rise: 6, win: [0.7, 1.2], chimney: false, quoins: true }),
    market: () => ({ roof: 'flat', fh: 6.5, gfh: 5, shop: ['+z'] }),
    depot: () => ({ fh: 5.5, rise: 2.2, chimney: false, openings: [{ face: '+z', s: 0, w: 4.4, h: 4, type: 'garage' }, { face: '+z', s: 5.6, w: 1, type: 'door' }] }),
    hall: () => ({ fh: 3.4, gfh: 4, rise: 3.5, shutters: true, quoins: true, openings: [{ face: '+z', s: 0, w: 1.8, type: 'entry' }] }),
    chalet: () => ({ fh: 2.8, rise: 3.6, shutters: true, openings: [{ face: '+z', s: 0, w: 1, type: 'door' }] }),
  };
  const WALLS = { church: 'wallStone', tower: 'wallStone', market: 'wallConc', depot: 'wallMetal', chalet: 'wallWood' };
  for (const b of L.buildings) {
    city.building(b.x, b.y || 0, b.z, b.yaw, { ...base, w: b.w, d: b.d, h: b.h, tint: b.wall, ...OPTS[b.kind](b) }, WALLS[b.kind] ? { wall: WALLS[b.kind] } : null);
  }
  scene.add(city.group(mats));

  // --- enseignes (texte éclairé la nuit) ---
  const signMats = [];
  for (const b of L.buildings) {
    if (!b.sign) continue;
    const c = document.createElement('canvas'); c.width = 512; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#2b2f35'; g.fillRect(0, 0, 512, 64); g.fillStyle = b.name === 'pharmacie' ? '#4be08a' : '#f4ead2';
    g.font = '700 44px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.name === 'pharmacie' ? '✚ ' + b.sign + ' ✚' : b.sign, 256, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 }); signMats.push(m);
    // sur le mur, au-dessus du store (vitrines) ou de l'auvent d'entrée, sous les fenêtres de l'étage
    const shop = b.kind === 'shop' || b.kind === 'market', w = Math.min(b.w - 2, shop ? 7 : 4), y = (b.y || 0) + (b.kind === 'market' ? 5.5 : shop ? 4.35 : b.kind === 'depot' ? 4.7 : 3.3);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 8), m), o = b.d / 2 + 0.03;
    sign.position.set(b.x + Math.sin(b.yaw) * o, y, b.z + Math.cos(b.yaw) * o); sign.rotation.y = b.yaw; scene.add(sign);
  }

  // --- lampadaires : mât et bras (kit, instanciés), tête émissive, flaque de lumière sur la neige ---
  const lampAcc = K.acc();
  lampAcc.cyl('metal', 0, 0, 0, 0.09, 6.6, 10); lampAcc.box('metal', -0.04, 6.45, 0, 0.04, 6.55, 1.5); lampAcc.box('lamp', -0.22, 6.3, 1.15, 0.22, 6.45, 1.75);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const lampM = L.lamps.map((l) => new THREE.Matrix4().compose(P.set(l.x, 0, l.z), Q.setFromEuler(E.set(0, l.a, 0)), ONE));
  scene.add(K.instanced(lampAcc.geometries(), { metal: std(0x2c3138, { roughness: 0.5, metalness: 0.5 }), lamp: lampMat }, lampM, { cast: false }));
  const pc = document.createElement('canvas'); pc.width = pc.height = 128; const pg = pc.getContext('2d'), gr = pg.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); pg.fillStyle = gr; pg.fillRect(0, 0, 128, 128);
  const poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), color: 0xffc27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = new THREE.InstancedMesh(new THREE.CircleGeometry(6, 24).rotateX(-Math.PI / 2), poolMat, L.lamps.length);
  L.lamps.forEach((l, i) => pools.setMatrixAt(i, M.makeTranslation(l.x + Math.sin(l.a) * 1.45, 0.24, l.z + Math.cos(l.a) * 1.45)));
  pools.computeBoundingSphere(); scene.add(pools);

  // --- dépôt : pompe à essence et tas de sel ---
  const dep = K.acc(), [px, pz] = L.depot.pump;
  dep.box('plinth', px - 0.8, 0, pz - 0.5, px + 0.8, 0.2, pz + 0.5); dep.box('pump', px - 0.4, 0.2, pz - 0.25, px + 0.4, 1.9, pz + 0.25); dep.box('dark', px - 0.3, 1.2, pz + 0.25, px + 0.3, 1.6, pz + 0.27);
  scene.add(K.group(dep.geometries(), { plinth: mats.plinth, dark: mats.dark, pump: std(0xb3262e, { roughness: 0.5 }), trim: mats.trim }));
  const salt = new THREE.Mesh(new THREE.ConeGeometry(3, 2.2, 20), std(0xd9d2c4)); salt.position.set(L.depot.salt[0], 1.1, L.depot.salt[1]); salt.castShadow = true; scene.add(salt);

  // --- voitures garées (instanciées par modèle et par pièce) avec neige sur le toit ---
  const cars = L.parked.map((p) => { const o = new THREE.Object3D(); o.position.set(p.x, 0, p.z); o.rotation.y = p.yaw; o.userData.model = p.model; return o; });
  // obstacles 2D (bâtiments, voitures, murs du parvis) ; l'emprise d'une voiture prend la taille de son modèle au chargement
  const solids = solidsFrom(L), carSolids = solids.filter((s) => s.car); cars.forEach((c, i) => { c.userData.solid = carSolids[i]; });
  const capGeo = new THREE.SphereGeometry(0.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat = std(0xeef3fa);
  const C = new THREE.Color();
  const ready = Promise.all([...new Set(L.parked.map((p) => p.model))].map(async (model) => {
    const k = bakeParts(await loadGLB(new URL(`../../../../assets/models/npc/car-${model}.glb`, import.meta.url).href), 1);
    if (k.size.x > k.size.z) { for (const p of k.parts) p.geo.rotateY(Math.PI / 2); [k.size.x, k.size.z] = [k.size.z, k.size.x]; } // grand axe sur z
    const list = cars.filter((c) => c.userData.model === model);
    for (const part of k.parts) {
      const body = /body/i.test(part.mat.name || ''), im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      list.forEach((c, i) => { c.updateMatrix(); im.setMatrixAt(i, c.matrix); im.setColorAt(i, body ? C.set(CAR_COLORS[(i * 3 + model.length) % CAR_COLORS.length]) : C.set(0xffffff)); });
      im.castShadow = im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im);
    }
    const caps = new THREE.InstancedMesh(capGeo, capMat, list.length), sm = new THREE.Matrix4().compose(P.set(0, k.size.y - 0.03, -0.04 * k.size.z), Q.identity(), new THREE.Vector3(k.size.x * 0.72, 0.22, k.size.z * 0.38));
    list.forEach((c, i) => { c.userData.size = k.size.clone(); c.userData.solid.hw = k.size.x / 2; c.userData.solid.hd = k.size.z / 2; caps.setMatrixAt(i, M.multiplyMatrices(c.matrix, sm)); });
    caps.computeBoundingSphere(); scene.add(caps);
  })).catch((e) => console.warn('voitures garées non chargées', e));

  // --- neige : un champ par zone (id = id de zone) et par trottoir, 20 cm de poudreuse au départ ---
  const add = (id, r, kind, y = 0, slope) => { const f = new SnowField({ id, ...r, y, kind, slope }); f.fill(START_DEPTH, DENS.powder); snow.add(f); };
  for (const z of L.zones) add(z.id, z.rect, z.kind, z.y, z.slope);
  L.sidewalks.forEach((r, i) => add('sidewalk-' + (i + 1), r, 'sidewalk'));

  return {
    cars, doors: L.doors, solids, ready,
    setNight(n) {
      K.setNight(mats, n); lampMat.emissiveIntensity = 2.2 * n; poolMat.opacity = 0.55 * n;
      for (const m of signMats) m.emissiveIntensity = 0.9 * n;
    },
  };
}
