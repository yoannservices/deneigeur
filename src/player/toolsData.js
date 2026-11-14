// Pelles et équipement du joueur à pied (données pures, prix du §8.1). Identifiants d'achat : shovel:<clé>, gear:<clé>.
export const SHOVELS = {
  base: { width: 0.5, capacity: 8, price: 0 },
  large: { width: 0.7, capacity: 12, price: 60 },
  pusher: { width: 0.9, capacity: 25, price: 90, noThrow: true },
};
export const GEAR = { steel: 70, gloves: 40, boots: 50, sled: 120, salt: 10 };
// gants : endurance max +20 ; bottes : ralentissement dû à la neige x 0,75 ; luge : 60 kg ; sel : 20 m², fond en 2 min de jeu
export const EFFECTS = { gloves: 20, boots: 0.75, sled: 60, salt: { area: 20, minutes: 2 } };
