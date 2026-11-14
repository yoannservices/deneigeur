/* Quad avec lame (§8.3), logique pure (aucun import de three) : prix des améliorations, adhérence, débord de la lame,
   quart du véhicule d'un point (découpe des pneus de quad-raptor.glb). Angle de lame > 0 = orientée à gauche (bout gauche
   en arrière : la neige glisse à gauche), comme steer > 0 = gauche. */
export const QUAD_UPGRADES = { vblade: 500, chains: 200, lights: 150, spreader: 700 }; // prix (€), §8.3
export const BLADE = { width: 1.5, capacity: 120, maxAngle: Math.PI / 6, slip: 1.5 }; // m, kg, ±30°, patine au-delà de 1,5 x la capacité

// quart d'un point autour du centre (cx, cz) : bit 1 = gauche (+x, convention de rigWheels), bit 2 = avant (+z)
export const quadrantOf = (x, z, cx, cz) => (x > cx ? 1 : 0) + (z > cz ? 2 : 0);

// pneus 0,6 ; chaînes : 0,9 sur neige tassée et verglas (surface : clé de MU)
export const quadGrip = (surface, chains) => (chains && (surface === 'packed' || surface === 'ice') ? 0.9 : 0.6);

/* kg qui peuvent glisser au bout de la lame par mètre d'avance : 60 lame droite, 300 orientée à fond. Lame orientée, le bout qui
   déverse roule aussi le bourrelet des passes précédentes (windrowSweep) : il passe tout entier par la lame à chaque voie
   (26 kg/m par voie de 1 m dans 20 cm), d'où 300 pour une moitié de parking. Passes droites côte à côte
   dans 20 cm de poudreuse : chacune reprend le bourrelet latéral de la précédente, soit 30 + 30 kg/m, et la charge reste à 120 kg.
   Au-delà, la charge poussée grossit : à plus de 1,5 x la capacité les roues patinent, il faut reculer et reprendre par passes. */
export const spillPerM = (angle) => 60 + 240 * Math.min(1, Math.abs(angle) / BLADE.maxAngle);

// côté du débord pour pushBlade (+1 = droite) : celui où la lame est orientée ; droite ou en V, aux deux bouts
export const spillSide = (angle, v) => (v ? 0 : angle > 0.02 ? -1 : angle < -0.02 ? 1 : 0);

/* Distance du débord au-delà du bout de la lame (pushBlade `beyond`, m) pour un débit de kgPerM kg par mètre d'avance :
   0,2 m + 1,3 x la demi-base d'un bourrelet à pente d'éboulement 0,9 (section = kgPerM / rho). Sans cela, le bourrelet qui grossit
   (chaque passe reprend le précédent) s'éboule dans la passe que l'on vient de dégager. */
export const windrowBeyond = (kgPerM, rho) => 0.2 + 1.3 * Math.sqrt(Math.max(0, kgPerM) / rho / 0.9);
/* Largeur (m) au-delà du bout qui déverse où la lame roule la neige meuble (pushBlade `sweepLoose`) : le flanc du bourrelet
   précédent, sinon coupé par la passe, s'écroulerait derrière la lame. 0,3 m en deçà du point de débord (pas de reprise immédiate). */
export const windrowSweep = (beyond) => Math.max(0, beyond - 0.3);
