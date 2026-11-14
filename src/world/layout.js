// Plan du quartier de montagne (données pures, aucun import de three).
// Repère : x vers l'est, z vers le nord, de 0 à 300 m ; Rect = { x0, z0, w, d } ; yaw = 0 : façade principale vers +z.
// Rue principale nord-sud (x 145 à 155), dépôt au bout (z > 280) ; trois rues résidentielles à l'ouest, commerces à l'est.
const R = (x0, z0, w, d) => ({ x0, z0, w, d });
const PI = Math.PI;

const MAIN = R(145, 0, 10, 280);
const STREETS = [R(10, 40, 135, 8), R(10, 120, 135, 8), R(10, 200, 135, 8)];

// Allées des 24 maisons [largeur, longueur] (m). N° 7 : grande allée en pente (fraise) ; n° 12 : allée du §7.
const DRIVES = [[3, 8], [4, 12], [3, 10], [4, 16], [3, 9], [4, 14], [4, 25], [3, 12], [4, 18], [3, 8], [4, 15], [4, 10],
  [3, 11], [4, 20], [3, 9], [4, 13], [3, 10], [4, 17], [3, 8], [4, 12], [4, 19], [3, 9], [4, 14], [3, 11]];
const HX = [32, 64, 96, 128];               // centres des maisons le long de chaque rue
const CARS = ['compact', 'hatchback', 'sedan', 'suv', 'wagon', 'minivan'];
const GARAGE_S = 2.5, DOOR_S = -2.5, SLOPE = 0.09;        // porte de garage et porte d'entrée, le long de la façade (repère local)

const houses = [], zones = [], doors = [], parked = [], lamps = [];
// repère local (s le long de la façade, o vers l'extérieur) -> monde, même rotation que three (rotation.y = yaw)
const rot = (yaw, s, o) => [s * Math.cos(yaw) + o * Math.sin(yaw), -s * Math.sin(yaw) + o * Math.cos(yaw)];
// devant une porte : carré de 2 x 2 m (tas de neige pénalisé)
const door = (b, s) => { const [dx, dz] = rot(b.yaw, s, b.d / 2 + 1); doors.push(R(b.x + dx - 1, b.z + dz - 1, 2, 2)); };
const GAIN = 1.5; // payes du §7 relevées de 50 % (demande de Yoann, 14/11/2026)
const zone = (id, name, rect, kind, tool, base, deadline, extra) => { const z = { id, name, rect, kind, tool, base: Math.round(base * GAIN), deadline, ...extra }; zones.push(z); return z; };

STREETS.forEach((st, si) => {
  for (let k = 0; k < 8; k++) {
    const n = si * 8 + k + 1, [dw, L] = DRIVES[n - 1], north = k >= 4, hx = HX[k % 4];
    const w = 10 + (n % 3), d = 8 + (n % 2), yaw = north ? PI : 0;
    const edge = north ? st.z0 + st.d : st.z0, front = north ? edge + L : edge - L;
    const cx = hx + (north ? -GARAGE_S : GARAGE_S);
    const drive = R(cx - dw / 2, north ? edge : front, dw, L);
    drive.mouth = R(drive.x0, north ? edge : edge - 1, dw, 1);
    const big = n === 7, id = 'allee-' + n;
    // grande allée : monte de 9 % en s'éloignant de la rue ; la maison est posée au sommet, sur un soubassement de pierre
    const slope = big ? { dx: 0, dz: north ? SLOPE : -SLOPE } : undefined;
    zone(id, big ? 'Grande allée en pente' : `Allée du n° ${n}`, drive, 'drive', big ? 'fraise' : 'pelle',
      big ? 90 : Math.max(15, Math.round((dw * L * 0.625) / 5) * 5), big ? 405 : n === 12 ? 420 : [420, 405, 390][n % 3], slope && { slope, y: north ? 0 : SLOPE * L });
    const h = { n, x: hx, z: north ? front + d / 2 : front - d / 2, y: big ? SLOPE * L : 0, yaw, w, d, drive, zone: id, garageS: GARAGE_S, doorS: DOOR_S };
    houses.push(h); door(h, DOOR_S);
    // voiture garée au bord de la rue, entre deux allées ; lampadaire côté sud
    if ((k + si) % 2 === 0) parked.push({ x: hx - 16, z: north ? edge - 1.2 : edge + 1.2, yaw: PI / 2 + (north ? PI : 0), model: CARS[(si * 8 + k) % 6] });
    if (!north) lamps.push({ x: hx - 8, z: st.z0 + 0.4, a: 0 });
  }
});

// Commerces et services (côté est de la rue principale)
const sidewalks = [R(143, 140, 2, 60), R(143, 208, 2, 62), R(155, 140, 2, 10), R(155, 165, 2, 105)];
zone('trottoir-boulangerie', 'Trottoir de la boulangerie', R(155, 150, 2, 15), 'sidewalk', 'pelle', 40, 360);
zone('acces-pharmacie', 'Accès de la pharmacie', R(157, 176.5, 10, 3), 'sidewalk', 'pelle', 30, 405);
zone('cour-ecole', "Cour de l'école", R(157, 190, 20, 15), 'yard', 'fraise', 120, 390);
zone('parking-supermarche', 'Parking du supermarché', R(155, 20, 40, 30), 'parking', 'quad', 300, 360);
zone('chemin-lotissement', 'Chemin du lotissement', R(155, 100, 120, 4), 'drive', 'quad', 220, 390);
// Escalier de l'église : 20 marches de 0,30 x 4 m qui montent de 0,17 m vers l'est ; un seul contrat (group)
const STAIRS = { x0: 162, z0: 228, w: 4, tread: 0.3, rise: 0.17, n: 20 };
for (let k = 0; k < STAIRS.n; k++) {
  zone('escalier-' + String(k + 1).padStart(2, '0'), "Escalier de l'église", R((STAIRS.x0 * 10 + k * STAIRS.tread * 10) / 10, STAIRS.z0, STAIRS.tread, STAIRS.w),
    'stairs', 'pelle', 30, 390, { y: STAIRS.rise * (k + 1), group: 'escalier-eglise' });
}
const TOP = STAIRS.rise * STAIRS.n;          // parvis de l'église : 3,4 m

// Bâtiments hors maisons. kind -> rendu dans Quartier.js ; y = hauteur du sol (église sur sa terrasse)
const buildings = [
  { kind: 'shop', name: 'boulangerie', sign: 'BOULANGERIE', x: 162.5, z: 157.5, yaw: -PI / 2, w: 15, d: 10, h: 6.8, wall: '#e3c9a0' },
  { kind: 'shop', name: 'pharmacie', sign: 'PHARMACIE', x: 171.5, z: 178, yaw: -PI / 2, w: 12, d: 9, h: 6.8, wall: '#d9e0d4' },
  { kind: 'school', name: 'école', sign: 'ÉCOLE', x: 183, z: 197.5, yaw: -PI / 2, w: 24, d: 12, h: 7.2, wall: '#e6d8b8' },
  { kind: 'church', name: 'église', x: 179, z: 230, y: TOP, yaw: 0, w: 18, d: 10, h: 9.5, wall: '#cfc6b4' },
  { kind: 'tower', name: 'clocher', x: 184, z: 240, y: TOP, yaw: 0, w: 5.5, d: 5.5, h: 17, wall: '#c4baa6' },
  { kind: 'market', name: 'supermarché', sign: 'SUPERMARCHÉ', x: 205, z: 35, yaw: -PI / 2, w: 36, d: 20, h: 6.5, wall: '#d4d6d8' },
  { kind: 'depot', name: 'garage du dépôt', sign: 'DÉPÔT', x: 160, z: 294, yaw: PI, w: 16, d: 10, h: 5.5, wall: '#b8bcc0' },
  { kind: 'shop', name: 'café', sign: 'CAFÉ', x: 136, z: 165, yaw: PI / 2, w: 14, d: 10, h: 6.8, wall: '#e8d2b0' },
  { kind: 'hall', name: 'mairie', sign: 'MAIRIE', x: 135, z: 255, yaw: PI / 2, w: 16, d: 12, h: 8, wall: '#efe6d2' },
  ...[185, 225, 265].flatMap((x, i) => [
    { kind: 'chalet', name: 'chalet', x, z: 114.5, yaw: PI, w: 10 + i % 2, d: 9, h: 5.6 },
    { kind: 'chalet', name: 'chalet', x: x + 4, z: 89.5, yaw: 0, w: 11 - i % 2, d: 9, h: 5.6 },
  ]),
];
// Porte d'une vitrine du kit (building-kit.js, type 'shop') : travée du milieu. shortcut: recopie la formule du kit, à revoir s'il change
export const shopDoorS = (L) => { const m = Math.max(0.6, Math.min(1.1, L / 2 - 0.5) * 0.6), sw = L - 2 * m, n = Math.max(2, Math.round(sw / 2.2)), sp = sw / n; return -L / 2 + m + (Math.floor(n / 2) + 0.5) * sp; };
for (const b of buildings) {
  if (b.kind === 'shop' || b.kind === 'market') door(b, shopDoorS(b.w));
  else if (b.kind === 'school' || b.kind === 'hall' || b.kind === 'depot' || b.kind === 'chalet') door(b, 0);
}
doors.push(R(STAIRS.x0 + STAIRS.n * STAIRS.tread, 229, 2, 2)); // parvis devant la porte de l'église (au sommet de l'escalier)

// Voitures sur la rue principale et lampadaires à 0,4 m du bord de chaussée (bras vers la rue : a = direction (sin a, cos a))
parked.push({ x: 146.2, z: 90, yaw: 0, model: 'sedan' }, { x: 146.2, z: 240, yaw: PI, model: 'wagon' },
  { x: 153.8, z: 172, yaw: PI, model: 'hatchback' }, { x: 153.8, z: 120, yaw: 0, model: 'suv' });
for (let z = 15; z < 280; z += 30) {
  if (!STREETS.some((s) => z > s.z0 - 2 && z < s.z0 + s.d + 2)) lamps.push({ x: MAIN.x0 + 0.4, z, a: PI / 2 });
  lamps.push({ x: MAIN.x0 + MAIN.w - 0.4, z, a: -PI / 2 });
}

export const LAYOUT = {
  size: 300,
  roads: [MAIN, ...STREETS],
  houses, zones, sidewalks, buildings, doors, parked, lamps,
  stairs: STAIRS,
  terrace: { ...R(168, 216, 22, 28), y: TOP },  // terrasse de l'église (mur de pierre), en haut de l'escalier
  depot: { ...R(130, 280, 40, 20), pump: [141, 287], salt: [137, 295] },
};
