/* Clavier (event.code : KeyW = Z et KeyA = Q sur AZERTY), souris et manette. `poll()` met à jour `inp` ; `pressed(code)` vaut une fois par appui. */
const down = new Set(), hit = new Set();

addEventListener('keydown', (e) => {
  // dans un menu (#screen visible), Tab, Espace et flèches gardent leur rôle de navigation (focus, clic du bouton)
  const menu = document.getElementById('screen')?.hidden === false;
  if (!menu && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (!e.repeat) hit.add(e.code);
  down.add(e.code);
});
addEventListener('keyup', (e) => down.delete(e.code));
addEventListener('blur', () => down.clear());

const any = (...c) => c.some((k) => down.has(k));
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
export const inp = { x: 0, z: 0, run: false, hand: false, throttle: 0, brake: 0, steer: 0, pad: false };
export const mouse = { dx: 0, dy: 0, left: false, right: false, locked: false };
export const pressed = (c) => hit.has(c);
export const held = (c) => down.has(c);
export const endFrame = () => { hit.clear(); mouse.dx = mouse.dy = 0; };

// Verrouillage du pointeur au clic sur le canvas ; le perdre met le jeu en pause (même effet que Échap).
const canvas = document.getElementById('gl');
canvas?.addEventListener('click', () => { if (!mouse.locked) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => {
  const was = mouse.locked;
  mouse.locked = document.pointerLockElement === canvas;
  if (was && !mouse.locked) { hit.add('Escape'); mouse.left = mouse.right = false; }
});
addEventListener('mousemove', (e) => { if (mouse.locked) { mouse.dx += e.movementX; mouse.dy += e.movementY; } });
addEventListener('mousedown', (e) => { if (!mouse.locked) return; if (e.button === 0) mouse.left = true; else if (e.button === 2) mouse.right = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; else if (e.button === 2) mouse.right = false; });
addEventListener('contextmenu', (e) => { if (mouse.locked) e.preventDefault(); });

// Boutons manette -> touches : A=Espace (turbine de la fraise ; reste aussi le frein à main inp.hand), B=F, Y=C, X=R, Start=Échap, Back=M,
// croix haut/bas=T/G, gauche/droite=A/E (KeyQ/KeyE), clic stick gauche=X (sel), clic stick droit=J (jerrican).
const PAD_KEYS = { 0: 'Space', 11: 'KeyJ', 1: 'KeyF', 3: 'KeyC', 2: 'KeyR', 9: 'Escape', 8: 'KeyM', 12: 'KeyT', 13: 'KeyG', 14: 'KeyQ', 15: 'KeyE', 10: 'KeyX' };
let padL = false, padR = false;
const padPrev = {}; // état précédent des boutons : getGamepads() renvoie un nouvel instantané à chaque appel (Chrome)

export function poll() {
  let x = (any('KeyD', 'ArrowRight') ? 1 : 0) - (any('KeyA', 'ArrowLeft') ? 1 : 0);
  let z = (any('KeyW', 'ArrowUp') ? 1 : 0) - (any('KeyS', 'ArrowDown') ? 1 : 0);
  let throttle = z > 0 ? 1 : 0, brake = z < 0 ? 1 : 0, hand = down.has('Space');
  const run = any('ShiftLeft', 'ShiftRight');
  const gp = (navigator.getGamepads && [...navigator.getGamepads()].find(Boolean)) || null;
  inp.pad = !!gp;
  if (gp) {
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    x += dz(gp.axes[0] || 0); z -= dz(gp.axes[1] || 0);
    throttle = Math.max(throttle, gp.buttons[7]?.value || 0);
    brake = Math.max(brake, gp.buttons[6]?.value || 0);
    hand = hand || !!gp.buttons[0]?.pressed;
    gp.buttons.forEach((b, i) => { if (PAD_KEYS[i] && b.pressed && !padPrev[i]) hit.add(PAD_KEYS[i]); padPrev[i] = b.pressed; });
    // RB = clic gauche (lancer), LB = clic droit (lever/baisser), suivis par front pour ne pas écraser la souris
    const rb = !!gp.buttons[5]?.pressed, lb = !!gp.buttons[4]?.pressed;
    if (rb !== padL) mouse.left = rb; if (lb !== padR) mouse.right = lb;
    padL = rb; padR = lb;
    mouse.dx += dz(gp.axes[2] || 0) * 14; mouse.dy += dz(gp.axes[3] || 0) * 14;
  }
  inp.x = clamp1(x); inp.z = clamp1(z); inp.steer = -inp.x; // steer > 0 = gauche, comme parking-master
  inp.throttle = throttle; inp.brake = brake; inp.hand = hand; inp.run = run;
}
