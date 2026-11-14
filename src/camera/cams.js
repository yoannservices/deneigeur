/* Caméras du joueur à pied : troisième personne (orbite à la souris) et première personne (C), tête du personnage cachée.
   look(t) lit la souris et cache la tête avant la mise à jour du joueur ; follow() place la caméra après. pitch > 0 = regard vers le bas.
   En véhicule (followCar), le même mode sert : 'third' = poursuite, 'first' = cabine (regard libre à la souris autour du cap). */
import { mouse } from '../core/input.js';
import { clamp, wrapPi } from '../core/util.js';

const SENS = 0.0025, DIST = 4, HEAD = 1.45;

export class Cams {
  constructor(camera) { this.camera = camera; this.mode = 'third'; this.yaw = 0; this.pitch = 0.35; }
  toggle() {
    this.mode = this.mode === 'third' ? 'first' : 'third';
    if (this.mode === 'first') this.pitch = Math.max(this.pitch, 0.8); // regard sur la pelle : mains (70° sous l'œil) et lame dans le cadre
  }
  look(t) {
    if (t) t.hideHead = this.mode === 'first'; // avant walker.update : pas d'image de retard au changement de vue
    this.yaw -= mouse.dx * SENS; // souris à droite = regard à droite (droite = (-cos yaw, sin yaw))
    this.pitch = this.mode === 'first' ? clamp(this.pitch + mouse.dy * SENS, -1.2, 1.3) : clamp(this.pitch + mouse.dy * SENS, -0.3, 1.2);
  }
  follow(t, dt) {
    const cam = this.camera, first = this.mode === 'first';
    if (first) {
      cam.position.copy(t.eye); cam.rotation.set(-this.pitch, this.yaw + Math.PI, 0, 'YXZ');
      return;
    }
    // shortcut: pas de rayon contre les maisons, la caméra peut passer dans un mur ; ajouter un Raycaster si c'est gênant
    const cp = Math.cos(this.pitch), tx = t.position.x, ty = t.position.y + HEAD, tz = t.position.z;
    cam.position.set(tx - Math.sin(this.yaw) * cp * DIST, Math.max(ty + Math.sin(this.pitch) * DIST, t.position.y + 0.3), tz - Math.cos(this.yaw) * cp * DIST);
    cam.lookAt(tx, ty, tz);
  }

  enterCar(v) { this.heading = v.phys.yaw; this.orbit = 0; this.cabYaw = 0; this.cabPitch = 0.12; }
  /* v : { phys, group, look } ; look = repère des yeux dans la caisse (suit tangage et roulis) */
  followCar(v, dt) {
    const cam = this.camera, p = v.phys;
    if (this.mode === 'first') {
      this.cabYaw = clamp(this.cabYaw - mouse.dx * SENS, -1.7, 1.7); this.cabPitch = clamp(this.cabPitch + mouse.dy * SENS, -0.5, 0.7);
      v.look.rotation.set(-this.cabPitch, this.cabYaw + Math.PI, 0, 'YXZ'); // la caméra regarde vers -z, l'avant de la caisse est +z
      v.look.getWorldPosition(cam.position); v.look.getWorldQuaternion(cam.quaternion);
      return;
    }
    // poursuite (cotes de parking-master « Poursuite ») : le cap suit avec retard, la souris tourne autour et revient seule
    this.heading += wrapPi(p.yaw - this.heading) * (1 - Math.exp(-3.2 * dt));
    this.orbit = (this.orbit - mouse.dx * SENS) * Math.exp(-1.2 * dt);
    // v.chase = [distance, hauteur] pour un petit engin (fraise), sinon cotes de la voiture
    const a = this.heading + this.orbit, [dist, up] = v.chase || [7.4 * (0.85 + 0.15 * p.d.length / 4.4), 2.9], y = v.group.position.y;
    cam.position.set(p.x - Math.sin(a) * dist, y + up, p.z - Math.cos(a) * dist);
    cam.lookAt(p.x + Math.sin(this.heading) * 2.2, y + 0.9, p.z + Math.cos(this.heading) * 2.2);
  }
}
