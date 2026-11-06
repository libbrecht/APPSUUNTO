// Couleurs de la FC : table « Ce que donnent les plans de Pichauris ».
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seance, ETATS, COULEURS } = require('./sim/scenario');

const { GRIS, VERT, ORANGE, ROUGE } = COULEURS;

// Place la séance dans le terrain voulu, traîne de 60 s écoulée, FC à « fc ».
function preparer(planInitial, terrain, fc) {
  const s = seance({ plan_initial: planInitial, grace: '0' });
  if (terrain === ETATS.MONTEE) s.jusqua(ETATS.MONTEE, 60, { vz: 720, fc });
  if (terrain === ETATS.DESCENTE) s.jusqua(ETATS.DESCENTE, 60, { vz: -720, fc });
  const vz = terrain === ETATS.MONTEE ? 720 : terrain === ETATS.DESCENTE ? -720 : 0;
  s.avancer(61, { vz, fc });
  assert.equal(s.sorties.etat, terrain);
  return { s, vz };
}

// Balaye la FC d'1 bpm par seconde (pas de rejet de pic) et relève la couleur
function balayer(planInitial, terrain, de, a) {
  const { s, vz } = preparer(planInitial, terrain, de);
  const couleurs = new Map();
  for (let fc = de; fc <= a; fc++) {
    couleurs.set(fc, s.avancer(1, { vz, fc }).couleur);
  }
  return couleurs;
}

// Couleur attendue d'après la table de la spécification
function attendue(fc, { vertDe, vertA, rougeDes }) {
  if (fc >= rougeDes) return ROUGE;
  if (fc > vertA) return ORANGE;
  if (vertDe === null || fc >= vertDe) return VERT;
  return GRIS;
}

const TABLE = [
  // terrain, plan, vert de, vert à, rouge dès
  ['plat', ETATS.PLAT, 'B', 149, 156, 159],
  ['montée', ETATS.MONTEE, 'B', 154, 161, 164],
  ['descente', ETATS.DESCENTE, 'B', null, 150, 154],
  ['plat', ETATS.PLAT, 'A', 154, 161, 164],
  ['montée', ETATS.MONTEE, 'A', 159, 166, 168],
  ['descente', ETATS.DESCENTE, 'A', null, 150, 154]
];

for (const [nom, terrain, plan, vertDe, vertA, rougeDes] of TABLE) {
  test(`plan ${plan}, ${nom} : vert ${vertDe ?? '…'} à ${vertA}, rouge dès ${rougeDes}`, () => {
    const couleurs = balayer(plan === 'A' ? '0' : '1', terrain, 130, 175);
    for (const [fc, c] of couleurs) {
      assert.equal(c, attendue(fc, { vertDe, vertA, rougeDes }), `FC ${fc}`);
    }
  });
}

test('descente : jamais de gris, même très bas', () => {
  const couleurs = balayer('0', ETATS.DESCENTE, 100, 130);
  for (const [fc, c] of couleurs) assert.equal(c, VERT, `FC ${fc}`);
});

test('marge réglable : marge 5 décale le rouge', () => {
  const s = seance({ marge: '5', grace: '0' });
  s.avancer(5, { fc: 160 });
  for (let fc = 160; fc <= 166; fc++) s.avancer(1, { fc });
  // cible plat A 160, marge 5 : rouge au-delà de 165, et plafond 167
  assert.equal(s.historique.at(-2).couleur, ORANGE); // 165
  assert.equal(s.historique.at(-1).couleur, ROUGE); // 166
});

test('le plafond absolu met au rouge quelle que soit la cible', () => {
  // Zone qui remonte la cible plat à 170 (vert 164 à 171) : 168 est vert
  // pour la cible mais au-dessus du plafond 167
  const s = seance({ zones: '0-99 p170', grace: '0' });
  s.avancer(5, { fc: 165 });
  assert.equal(s.avancer(1, { fc: 167 }).couleur, VERT);
  assert.equal(s.avancer(1, { fc: 168 }).couleur, ROUGE);
});
