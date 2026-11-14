/* Cinématique inverse à deux os : ik() recopiée de downhill-riders/src/rider/RiderModel.js ;
   solveArm() l'applique aux os Mixamo (bras, avant-bras, main) après mixer.update. */
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _d = V(), _p = V();

/* cinématique inverse à deux os : renvoie le coude/genou, et ramène la cible à portée */
export function ik(a, target, l1, l2, pole, outJoint, outEnd) {
  _d.subVectors(target, a); let L = _d.length(); const max = l1 + l2 - 0.002;
  if (L > max) { _d.multiplyScalar(max / L); L = max; }
  if (L < 0.12) { _d.setLength(0.12); L = 0.12; }
  const x = (L * L + l1 * l1 - l2 * l2) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - x * x)), dn = _p.copy(_d).normalize();
  const pv = pole.clone().addScaledVector(dn, -pole.dot(dn)).normalize();
  outJoint.copy(a).addScaledVector(dn, x).addScaledVector(pv, h); outEnd.copy(a).add(_d);
}

const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _r = new THREE.Quaternion(), _a = V(), _b = V(), _c = V();
// Tourne un os de q exprimé dans le repère du monde : local' = P⁻¹ · q · P · local (P = rotation monde du parent).
export function rotateWorld(bone, q) {
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.premultiply(_q.copy(_pq).invert().multiply(q).multiply(_pq));
  bone.updateMatrixWorld(true);
}
// Oriente `bone` pour que son enfant `child` passe par `target` (monde).
function aim(bone, child, target) {
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _b.sub(_a).normalize(); _c.subVectors(target, _a).normalize();
  rotateWorld(bone, _r.setFromUnitVectors(_b, _c));
}

const _s = V(), _e = V(), _h = V(), _J = V(), _E = V();
export function solveArm(bones, target, pole) {
  const { arm, fore, hand } = bones;
  arm.getWorldPosition(_s); fore.getWorldPosition(_e); hand.getWorldPosition(_h);
  ik(_s, target, _s.distanceTo(_e), _e.distanceTo(_h), pole, _J, _E);
  aim(arm, fore, _J); aim(fore, hand, _E);
}
