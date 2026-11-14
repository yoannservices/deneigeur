/* Roues de quad-raptor.glb : les 4 pneus forment un seul maillage (matériau color_2829873). Découpe par quart du véhicule
   (quadrantOf, centre de chaque triangle autour de (cx, cz)) avec `carve` de glb.js, puis les jantes et moyeux (triangles des
   autres maillages dans le cylindre de chaque pneu) suivent leur pneu. Chaque roue a le format de rigWheels (pivot sur son axe)
   pour poseWheel. Le modèle doit être cadré par fitGLB et hors de la scène (repère monde = repère du modèle). */
import * as THREE from 'three';
import { carve } from '../../../../assets/glb.js';
import { quadrantOf } from './quadLogic.js';

export function splitWheels(mesh, cx = 0, cz = 0) {
  let root = mesh; while (root.parent) root = root.parent;
  const tyres = carve(root, (o, c) => (o === mesh ? 'w' + quadrantOf(c.x, c.z, cx, cz) : null));
  const keys = ['w0', 'w1', 'w2', 'w3'].filter((k) => tyres[k]);
  const boxes = keys.map((k) => tyres[k].reduce((b, m) => b.expandByObject(m), new THREE.Box3()));
  // jante dans le pneu : dans sa largeur et à moins de 95 % de son rayon de l'axe (les bras de suspension restent à l'intérieur)
  const isTyre = new Set(keys.flatMap((k) => tyres[k]));
  const rims = carve(root, (o, c) => {
    if (isTyre.has(o)) return null;
    for (let k = 0; k < keys.length; k++) {
      const b = boxes[k], r = (b.max.y - b.min.y) / 2, yc = (b.max.y + b.min.y) / 2, zc = (b.max.z + b.min.z) / 2;
      if (c.x > b.min.x && c.x < b.max.x && Math.hypot(c.y - yc, c.z - zc) < 0.95 * r) return keys[k];
    }
    return null;
  });
  root.updateMatrixWorld(true);
  return keys.map((k, n) => {
    const c = boxes[n].getCenter(new THREE.Vector3()), par = tyres[k][0].parent;
    const pivot = new THREE.Group(), spin = new THREE.Group(), inv = par.matrixWorld.clone().invert();
    pivot.position.copy(par.worldToLocal(c.clone())); par.add(pivot); pivot.add(spin); pivot.updateMatrixWorld(true);
    for (const m of [...tyres[k], ...(rims[k] || [])]) spin.attach(m);
    const q = +k[1];
    return { front: (q & 2) > 0, left: (q & 1) > 0, c, pivot, spin, mesh: tyres[k][0], ax: new THREE.Vector3(1, 0, 0).transformDirection(inv), ay: new THREE.Vector3(0, 1, 0).transformDirection(inv) };
  });
}
