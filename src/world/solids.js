// Obstacles au sol en 2D (logique pure, aucun import de three) : rectangles orientés { x, z, hw, hd, yaw },
// hw le long de l'axe x local, hd le long de z local, même rotation que three (rotation.y = yaw). Réutilisés par les véhicules.
import { clamp } from '../core/util.js';

// Déplacement [dx, dz] qui sort le cercle (x, z, r) du rectangle s, ou null s'il ne le touche pas.
export function pushOut(x, z, r, s) {
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw), dx = x - s.x, dz = z - s.z;
  const lx = dx * c - dz * n, lz = dx * n + dz * c;
  const ox = lx - clamp(lx, -s.hw, s.hw), oz = lz - clamp(lz, -s.hd, s.hd), d2 = ox * ox + oz * oz;
  if (d2 >= r * r) return null;
  let mx = 0, mz = 0;
  if (d2 > 1e-12) { const d = Math.sqrt(d2), k = (r - d) / d; mx = ox * k; mz = oz * k; }
  else { // centre dans le rectangle : sortie par la face la plus proche
    const ex = s.hw - Math.abs(lx), ez = s.hd - Math.abs(lz);
    if (ex < ez) mx = (lx < 0 ? -1 : 1) * (ex + r); else mz = (lz < 0 ? -1 : 1) * (ez + r);
  }
  return [mx * c + mz * n, -mx * n + mz * c];
}

// Sort le cercle de tous les obstacles (2 passes pour les coins entre deux rectangles). Boîte englobante d'abord.
// shortcut: boucle sur toute la liste (une soixantaine), passer à une grille au-delà de quelques centaines
export function collide(x, z, r, solids) {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const s of solids) {
      const e = s.hw + s.hd + r; // majore la demi-diagonale
      if (Math.abs(x - s.x) > e || Math.abs(z - s.z) > e) continue;
      const m = pushOut(x, z, r, s); if (m) { x += m[0]; z += m[1]; moved = true; }
    }
    if (!moved) break;
  }
  return [x, z];
}

// Maisons, bâtiments, voitures garées (car: true ; taille par défaut, remplacée par celle du modèle chargé)
// murs du parvis de l'église (ouverts en haut de l'escalier), pompe et tas de sel du dépôt.
export function solidsFrom(L) {
  const S = [...L.houses, ...L.buildings].map((b) => ({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, yaw: b.yaw }));
  for (const c of L.parked) S.push({ x: c.x, z: c.z, hw: 0.95, hd: 2.3, yaw: c.yaw, car: true });
  const T = L.terrace, St = L.stairs, t = 0.1, wall = (x0, z0, x1, z1) => S.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, yaw: 0 });
  wall(T.x0, T.z0, T.x0 + T.w, T.z0 + 2 * t); wall(T.x0, T.z0 + T.d - 2 * t, T.x0 + T.w, T.z0 + T.d); wall(T.x0 + T.w - 2 * t, T.z0, T.x0 + T.w, T.z0 + T.d);
  wall(T.x0, T.z0, T.x0 + 2 * t, St.z0); wall(T.x0, St.z0 + St.w, T.x0 + 2 * t, T.z0 + T.d);
  const [px, pz] = L.depot.pump, [sx, sz] = L.depot.salt;
  S.push({ x: px, z: pz, hw: 0.8, hd: 0.5, yaw: 0 }, { x: sx, z: sz, hw: 2.2, hd: 2.2, yaw: 0 }); // socle de la pompe, cône de sel (rayon 3 m au sol)
  return S;
}

// Le rectangle orienté s ({ x, z, hw, hd, yaw }) touche-t-il un obstacle ? Cercles de rayon hw sur son grand axe local z (comme collideCar).
export function overlaps(s, solids) {
  const r = Math.min(s.hw, s.hd), along = s.hd >= s.hw, half = Math.abs(s.hd - s.hw), n = Math.ceil(half / r) + 1;
  const ax = along ? Math.sin(s.yaw) : Math.cos(s.yaw), az = along ? Math.cos(s.yaw) : -Math.sin(s.yaw);
  for (let k = 0; k < n; k++) {
    const t = n > 1 ? -half + 2 * half * k / (n - 1) : 0, x = s.x + ax * t, z = s.z + az * t;
    for (const o of solids) if (pushOut(x, z, r - 1e-6, o)) return true;
  }
  return false;
}

// Touche R : place libre pour s (même cap). s lui-même s'il est libre et ok(s.x, s.z) (enlisé : ok refuse la place actuelle), sinon anneaux de 1 m en 1 m jusqu'à 40 m : la première place
// libre où ok(x, z) est vrai (chaussée) à 15 m au plus, sinon la place libre la plus proche. null si rien.
export function freeSpot(s, solids, ok = () => true) {
  if (!overlaps(s, solids) && ok(s.x, s.z)) return [s.x, s.z];
  let any = null;
  for (let R = 1; R <= 40; R++) {
    const n = Math.ceil(2 * Math.PI * R);
    for (let k = 0; k < n; k++) {
      const a = 2 * Math.PI * k / n, x = s.x + Math.cos(a) * R, z = s.z + Math.sin(a) * R;
      if (overlaps({ ...s, x, z }, solids)) continue;
      if (ok(x, z)) return [x, z];
      any ??= [x, z];
    }
    if (any && R >= 15) return any; // aucune chaussée à 15 m : la place libre la plus proche
  }
  return any;
}
