/* Physique commune des véhicules (pick-up, quad), sans dépendance à Three.js (testable en Node). Partie de
   parking-master/src/car/physics.js : modèle « bicyclette » autour de l'essieu arrière, avec en plus une glissade latérale.
   Cap yaw : l'avant pointe vers (sin yaw, cos yaw) ; gauche = (cos yaw, -sin yaw) ; steer > 0 = gauche.
   Vitesses de l'essieu arrière en m/s : v le long de la caisse (positive en marche avant), vl vers la gauche.
   Adhérence disponible A = g × grip × mu : grip = pneus (0 à 1 ; chaînes de la tâche 10 : 0,6 -> 0,9), mu = surface donnée
   par l'appelant (MU : chaussée nue 0,9, neige tassée 0,5, neige fraîche 0,35, verglas 0,1 ; 1 par défaut = sol sec).
   A borne l'accélération et le freinage (4 roues motrices, ABS) et la force latérale. Le cap suit la direction tant que
   l'accélération latérale demandée tient dans A ; au-delà, la rotation du cap est bornée et la vitesse (fixe dans le monde)
   ne tourne qu'au rythme de A : la voiture part vers l'extérieur du virage et vl ne revient vers 0 qu'au rythme de A.
   Frein à main : roues arrière bloquées, peu de grip latéral à l'arrière -> le cap tourne plus vite que la trajectoire (survirage).
   drag (résistance de la neige 0 à 1) : la vitesse de pointe devient vmax × (1 - drag). */
import { clamp, smooth } from '../core/util.js';
import { pushOut } from '../world/solids.js';

export const VMAX = 14;        // m/s en avant (50 km/h dans le quartier)
export const VMAX_REV = 4.2;   // m/s en marche arrière (≈ 15 km/h)
export const MU = { asphalt: 0.9, packed: 0.5, snow: 0.35, ice: 0.1 };
const G = 9.81;

/* Résistance de la neige sous les roues motrices. Pick-up : la poudreuse freine un peu, au-delà de 25 cm il patine
   (il n'avance plus qu'au pas). Quad : un bourrelet de plus de 40 cm le ralentit, de plus de 70 cm le bloque. */
export function snowDrag(depthM, vehicle) {
  const d = Math.max(0, depthM);
  if (vehicle === 'quad') return d > 0.7 ? { drag: 1, stuck: true } : { drag: d > 0.4 ? 0.5 : 0, stuck: false };
  return d > 0.25 ? { drag: 0.95, stuck: true } : { drag: d * 0.8, stuck: false };
}

export class CarPhysics {
  /* dim : { length, width, wheelbase, rearBehind } ; rearBehind = distance entre l'essieu arrière et le centre de la caisse. */
  constructor(dim) {
    this.d = dim;
    this.vmax = VMAX; this.grip = 1; this.mu = 1; this.drag = 0;
    this.place(0, 0, 0);
  }

  place(x, z, yaw) {
    const d = this.d;
    this.yaw = yaw;
    this.rx = x - Math.sin(yaw) * d.rearBehind; // essieu arrière
    this.rz = z - Math.cos(yaw) * d.rearBehind;
    this.v = 0; this.vl = 0; this.steer = 0; this.acc = 0; this.yawRate = 0;
  }

  get x() { return this.rx + Math.sin(this.yaw) * this.d.rearBehind; }
  get z() { return this.rz + Math.cos(this.yaw) * this.d.rearBehind; }
  get speed() { return Math.hypot(this.v, this.vl); }

  step(dt, inp) {
    if (!(dt > 0)) return; // dt = 0 (deux images au même instant) : acc deviendrait NaN
    const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
    for (let i = 0; i < n; i++) this.sub(h, inp);
  }

  sub(dt, inp) {
    const v0 = this.v, drag = clamp(this.drag, 0, 1), hand = !!inp.hand;
    const A = G * clamp(this.grip, 0.05, 1) * clamp(this.mu, 0.02, 1.2);
    const top = Math.max(1e-6, this.vmax * (1 - drag)), topRev = Math.max(1e-6, VMAX_REV * (1 - drag)); // drag 1 (quad bloqué) : pas de 0 / 0
    let v = v0;
    const thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    if (hand) v = approach(v, 0, Math.min(7.5, 0.7 * A) * dt);
    else if (thr > 0 && brk === 0) {
      if (v < -0.25) v = approach(v, 0, Math.min(9, A) * dt);                       // on freine d'abord, puis on repart
      else v += Math.min(3.6 * (1 - clamp(Math.max(v, 0) / top, 0, 1) ** 1.5) + (v < 0.4 ? 0.9 : 0), A) * thr * dt;
    } else if (brk > 0) {
      if (v > 0.25) v = approach(v, 0, Math.min(9.5, A) * brk * dt);
      // écart voulu avec parking-master : le coup de pouce de 0,8 m/s² au démarrage en marche arrière s'ajoute
      // (dans parking-master il est retranché, probablement une erreur de signe, ce qui ralentit le départ en arrière)
      else v -= Math.min(2.8 * (1 - clamp(-v / topRev, 0, 1) ** 1.5) + (v > -0.4 ? 0.8 : 0), A) * brk * dt;
    } else {
      v = approach(v, 0, (Math.abs(v) < 1.5 ? 2.4 : 1.4) * dt);          // frein moteur : on s'arrête sans traîner
    }
    // la neige freine au-delà de la vitesse qu'elle permet (entrer vite dans une allée enneigée)
    if (v > top) v = approach(v, top, (4 + 8 * drag) * dt); else if (v < -topRev) v = approach(v, -topRev, (4 + 8 * drag) * dt);
    this.v = clamp(v, -VMAX_REV, this.vmax);

    // direction : braquage maxi décroissant avec la vitesse, lissage exponentiel pour rester fluide
    const max = 0.62 - 0.4 * smooth(0, 10, Math.abs(this.v));
    const target = inp.steer * max;
    this.steer += (target - this.steer) * (1 - Math.exp(-(inp.steer ? 7 : 9) * dt));

    // adhérence latérale : ce qui reste après l'effort longitudinal (cercle de friction ; l'ABS en garde 30 %), réduite au frein à main
    const aLong = Math.abs(this.v - v0) / dt;
    const aF = Math.max(Math.sqrt(Math.max(0, A * A - aLong * aLong)), 0.3 * A), aLat = aF * (hand ? 0.4 : 1);
    // cap : celui de la direction, borné quand l'avant ne tient plus (au frein à main l'arrière décroche : survirage)
    const L = this.d.wheelbase, rMax = (hand ? 2.2 : 1.2) * aF / Math.max(Math.abs(this.v), 0.5);
    const r = clamp(this.v * Math.tan(this.steer) / L * (hand ? 1.5 : 1), -rMax, rMax), da = r * dt;
    // la vitesse ne tourne pas avec la caisse : on la réexprime dans le nouveau cap, puis les pneus ramènent vl vers 0
    const c = Math.cos(da), s = Math.sin(da), vf = this.v * c + this.vl * s, vl = this.vl * c - this.v * s;
    this.v = vf; this.vl = approach(vl, 0, aLat * dt);
    this.yawRate = r; this.yaw += da;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.rx += (fx * this.v + fz * this.vl) * dt;
    this.rz += (fz * this.v - fx * this.vl) * dt;
    this.acc += ((this.v - v0) / dt - this.acc) * Math.min(1, 6 * dt);   // accélération lissée (tangage de la caisse)
  }

  /* Repousse la voiture hors d'un obstacle (normale n de l'obstacle vers la voiture) et retire la vitesse qui allait dedans. */
  push(nx, nz, depth) {
    this.rx += nx * depth; this.rz += nz * depth;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), wx = fx * this.v + fz * this.vl, wz = fz * this.v - fx * this.vl, vn = wx * nx + wz * nz;
    if (vn >= 0) return;
    const ux = wx - vn * nx, uz = wz - vn * nz;
    this.v = ux * fx + uz * fz; this.vl = ux * fz - uz * fx;
  }
}

/* Caisse contre obstacles (rectangles orientés de solids.js) : cercles de rayon largeur/2 le long de l'axe, plus 4 petits
   cercles dans les coins (calculés une fois par jeu de cotes). Renvoie la plus forte vitesse d'impact (m/s, composante
   vers l'obstacle), 0 sans contact. */
export function collideCar(ph, solids) {
  const d = ph.d;
  if (ph._ptsFor !== d) {
    const R = d.width / 2, half = d.length / 2 - R, n = Math.max(1, Math.ceil(2 * half / R)), c = 0.2;
    ph._pts = [];
    for (let k = 0; k <= n; k++) ph._pts.push([0, -half + (2 * half * k) / n, R]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ph._pts.push([sx * (d.width / 2 - c), sz * (d.length / 2 - c), c]);
    ph._ptsFor = d;
  }
  let hit = 0;
  const fx = Math.sin(ph.yaw), fz = Math.cos(ph.yaw); // push ne tourne pas la caisse
  for (const [lx, lz, r] of ph._pts) {
    for (const s of solids) {
      const x = ph.x + fz * lx + fx * lz, z = ph.z - fx * lx + fz * lz; // lx vers la gauche
      const e = s.hw + s.hd + r;
      if (Math.abs(x - s.x) > e || Math.abs(z - s.z) > e) continue;
      const m = pushOut(x, z, r, s); if (!m) continue;
      const depth = Math.hypot(m[0], m[1]); if (depth < 1e-9) continue;
      const nx = m[0] / depth, nz = m[1] / depth, vn = -((fx * ph.v + fz * ph.vl) * nx + (fz * ph.v - fx * ph.vl) * nz);
      if (vn > hit) hit = vn;
      ph.push(nx, nz, depth);
    }
  }
  return hit;
}

function approach(v, target, step) {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}
