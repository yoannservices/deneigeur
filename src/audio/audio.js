/* Sons en Web Audio, aucun fichier (modèle : chantier-carriere/src/audio/audio.js). Aucun import de three.
   createAudio() -> { shovel(kg), scrape(on, speed), engine(id, rpm, load), wind(level), pause(on), stop(), setVolume(v), debug() }
   - Le AudioContext n'est créé qu'au premier geste (pointerdown / keydown / touchstart), jamais avant : pas d'avertissement d'autoplay.
   - Nœuds persistants (moteur : dent de scie + carré, bruit de raclage, bruit de vent), seule la pelle crée des nœuds jetables.
   - engine(id, rpm, load) : id 'pickup' | 'quad' | 'blower' | null (null = moteur coupé) ; rpm 0..1 (régime relatif), load 0..1.
     Fraise : plus la neige avalée est lourde, plus le moteur est grave et le souffle de turbine fort (le régime s'écroule en surcharge).
   - wind(level) : 0..1 (chute de neige, cmPerHour / 4). pause(true) coupe tout (menus, pause) ; stop() ferme le contexte (retour au titre).
   Volume : ni la sauvegarde ni quality.js n'en portent ; constante VOLUME (shortcut: pas de curseur, à ajouter avec un réglage du site). */
export const VOLUME = 0.8;
const PROFILE = { // f0 : fondamentale au régime 0 et 1 (Hz), cut : coupure du filtre, g : gain
  pickup: { f: [28, 70], cut: [260, 700], g: 0.09, sq: 0.5 },
  quad: { f: [45, 130], cut: [420, 1400], g: 0.07, sq: 0.3 },
  blower: { f: [35, 95], cut: [380, 1100], g: 0.08, sq: 0.7 },
};

export function createAudio() {
  let ctx = null, S = null, paused = false, last = { id: null, rpm: 0, load: 0, wind: 0, scrape: 0, speed: 0 };
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  const events = ['pointerdown', 'keydown', 'touchstart'];
  const unlock = () => {
    if (!AC) return;
    if (!ctx) { try { build(); } catch { ctx = null; return; } }
    ctx.resume?.();
    apply();
  };
  for (const e of events) addEventListener(e, unlock, { passive: true });

  function build() {
    ctx = new AC();
    const out = ctx.createGain(); out.gain.value = VOLUME; out.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
    const noise = (type, f, q = 1) => {
      const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(0, Math.random());
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; n.connect(fl); fl.connect(g); g.connect(out); return { g: g.gain, f: fl.frequency };
    };
    const eng = { o: osc('sawtooth', 30), o2: osc('square', 15), f: ctx.createBiquadFilter(), g: ctx.createGain(), sq: ctx.createGain() };
    eng.f.type = 'lowpass'; eng.f.frequency.value = 300; eng.g.gain.value = 0; eng.sq.gain.value = 0.5;
    eng.o.connect(eng.f); eng.o2.connect(eng.sq); eng.sq.connect(eng.f); eng.f.connect(eng.g); eng.g.connect(out);
    const lfo = osc('sine', 9), lg = ctx.createGain(); lg.gain.value = 3; lfo.connect(lg); lg.connect(eng.o.frequency); // ralenti irrégulier
    S = { out, buf, eng, scrape: noise('bandpass', 500, 0.8), wind: noise('bandpass', 600, 0.5), blow: noise('bandpass', 900, 0.7) };
    S.windLfo = osc('sine', 0.15); const wl = ctx.createGain(); wl.gain.value = 150; S.windLfo.connect(wl); wl.connect(S.wind.f); // rafales
  }

  function apply() {
    if (!ctx || !S) return;
    const t = ctx.currentTime, k = paused ? 0 : 1, { id, rpm, load } = last, P = PROFILE[id];
    const e = S.eng;
    if (P) {
      const f = P.f[0] + (P.f[1] - P.f[0]) * rpm;
      // fraise : la charge baisse la fondamentale (moteur qui peine) et ouvre le souffle ; ailleurs la charge monte le régime
      const fl = id === 'blower' ? f * (1 - 0.35 * load) : f * (1 + 0.2 * load);
      e.o.frequency.setTargetAtTime(fl, t, 0.1); e.o2.frequency.setTargetAtTime(fl / 2, t, 0.1);
      e.f.frequency.setTargetAtTime(P.cut[0] + (P.cut[1] - P.cut[0]) * (0.4 * rpm + 0.6 * load), t, 0.1);
      e.sq.gain.setTargetAtTime(P.sq, t, 0.1);
    }
    e.g.gain.setTargetAtTime(P ? k * P.g * (0.6 + 0.8 * Math.max(rpm, load)) : 0, t, 0.12);
    S.blow.g.setTargetAtTime(id === 'blower' ? k * (0.04 + 0.2 * load) * Math.min(1, rpm * 1.5) : 0, t, 0.1);
    S.blow.f.setTargetAtTime(700 + 1300 * load, t, 0.1);
    S.scrape.g.setTargetAtTime(k * last.scrape * Math.min(1, last.speed / 3 + 0.2) * 0.2, t, 0.06);
    S.scrape.f.setTargetAtTime(350 + Math.min(last.speed, 8) * 90, t, 0.1);
    S.wind.g.setTargetAtTime(k * last.wind * 0.12, t, 0.8);
  }

  return {
    // un coup de pelle jeté : bruit qui retombe, plus long et plus grave quand la charge est lourde (kg)
    shovel(kg = 5) {
      if (!ctx || !S || paused) return;
      const t = ctx.currentTime, dur = 0.25 + Math.min(kg, 30) * 0.01, s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      s.buffer = S.buf; fl.type = 'lowpass'; fl.frequency.setValueAtTime(2200, t); fl.frequency.exponentialRampToValueAtTime(400, t + dur);
      g.gain.setValueAtTime(Math.min(0.5, 0.15 + kg * 0.01), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fl); fl.connect(g); g.connect(S.out); s.start(t, Math.random()); s.stop(t + dur);
    },
    scrape(on, speed = 0) { last.scrape = on ? 1 : 0; last.speed = Math.abs(speed); apply(); },
    engine(id, rpm = 0, load = 0) { last.id = id; last.rpm = Math.min(1, Math.max(0, rpm)); last.load = Math.min(1, Math.max(0, load)); apply(); },
    wind(level = 0) { last.wind = Math.min(1, Math.max(0, level)); apply(); },
    pause(on) { if (paused === on) return; paused = on; apply(); },
    // retour au titre : tout est coupé, le contexte reste (réutilisé au prochain geste)
    stop() { last = { id: null, rpm: 0, load: 0, wind: 0, scrape: 0, speed: 0 }; apply(); },
    setVolume(v) { if (S) S.out.gain.value = v; },
    // lecture des valeurs pour les essais (panneau caché) : null avant le premier geste
    debug() { return S ? { state: ctx.state, f: S.eng.o.frequency.value, cut: S.eng.f.frequency.value, eng: S.eng.g.gain.value, blow: S.blow.g.value, wind: S.wind.g.value, scrape: S.scrape.g.value } : null; },
  };
}
