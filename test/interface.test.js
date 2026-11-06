// Écrans, bascule de plan et résumé de fin.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seance, decoderUi, ETATS, COULEURS, ENTETES } = require('./sim/scenario');

test('bascule en deux gestes : appui long puis appui court', () => {
  const s = seance();
  s.avancer(10);
  assert.equal(s.app.gabarit, 't');
  assert.equal(s.sorties.plan, 1);

  s.app.onEvent(1); // appui long sur le bouton bas
  assert.equal(s.app.gabarit, 'cb', 'demande « Passer en plan B ? »');
  assert.equal(s.app.sorties().plan, 1, 'rien ne change avant la confirmation');

  const o = s.app.onEvent(2); // appui court : oui
  assert.equal(s.app.gabarit, 't');
  assert.equal(o.plan, 2);
  assert.equal(decoderUi(o.ui).entete, ENTETES.PLAN_B);
  assert.equal(decoderUi(o.ui).plan, 1);

  s.app.onEvent(1);
  assert.equal(s.app.gabarit, 'ca', 'retour possible vers le plan A');
  s.app.onEvent(2);
  assert.equal(s.app.sorties().plan, 1);
  assert.equal(s.app.variable('nBascules'), 2);
});

test('n\'importe quel autre bouton annule', () => {
  const s = seance();
  s.avancer(10);
  s.app.onEvent(1);
  s.app.onEvent(3);
  assert.equal(s.app.gabarit, 't');
  assert.equal(s.app.sorties().plan, 1);
  assert.equal(s.app.variable('nBascules'), 0);
});

test('un appui court seul ne bascule jamais', () => {
  const s = seance();
  s.avancer(10);
  s.app.onEvent(2);
  assert.equal(s.app.sorties().plan, 1);
  assert.equal(s.app.variable('nBascules'), 0);
});

test('sans réponse, la confirmation s\'annule au bout de 10 s', () => {
  const s = seance();
  s.avancer(10);
  s.app.onEvent(1);
  s.avancer(9);
  assert.equal(s.app.gabarit, 'cb');
  s.avancer(1);
  assert.equal(s.app.gabarit, 't');
  assert.equal(s.sorties.plan, 1);
});

test('les bascules sont libres, dans les deux sens, et datées', () => {
  const s = seance();
  for (let i = 0; i < 5; i++) {
    s.avancer(600, { km: (t) => t / 300 });
    s.app.onEvent(1);
    s.app.onEvent(2);
  }
  assert.equal(s.app.variable('nBascules'), 5);
  const resume = s.app.getSummaryOutputs();
  const bascules = resume.find((r) => r.id === 'b');
  assert.equal(bascules.value, 5);
  assert.equal(bascules.postfix, 'B 2km 0h10 | A 4km 0h20 | B 6km 0h30 ...');
});

test('plan initial B', () => {
  const s = seance({ plan_initial: '1' });
  assert.equal(s.avancer(1).plan, 2);
  assert.equal(s.sorties.cible, 155);
  s.app.onEvent(1);
  assert.equal(s.app.gabarit, 'ca');
});

test('la confirmation affiche les cibles et le plafond de l\'autre plan', () => {
  const s = seance();
  const o = s.avancer(1);
  const v = Math.round(o.np);
  assert.deepEqual([Math.floor(v / 40000) + 50, Math.floor(v / 200) % 200 + 50, v % 200 + 50], [155, 160, 150]);
  assert.equal(o.npc, 165);
  assert.ok(v < 2 ** 24, 'exact en flottant 32 bits');
});

test('bilan : appui court, retour par bouton ou au bout de 30 s', () => {
  const s = seance();
  s.avancer(10);
  s.app.onEvent(4);
  assert.equal(s.app.gabarit, 'b');
  s.app.onEvent(5);
  assert.equal(s.app.gabarit, 't');
  s.app.onEvent(4);
  s.avancer(29);
  assert.equal(s.app.gabarit, 'b');
  s.avancer(1);
  assert.equal(s.app.gabarit, 't');
});

test('écran principal : l\'en-tête suit le terrain, la FC sa couleur', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(10, { fc: 158 });
  assert.deepEqual([s.ui().entete, s.ui().couleur], [ENTETES.PLAT, COULEURS.VERT]);
  s.jusqua(ETATS.MONTEE, 60, { vz: 720, fc: 158 });
  assert.equal(s.ui().entete, ENTETES.MONTEE);
  assert.equal(s.ui().bas, 0, 'VAM en montée');
  s.avancer(30, { vz: 720, fc: 158 });
  assert.equal(s.sorties.vam, 720);
  s.jusqua(ETATS.ARRET, 60, { vz: 0, vit: 0, fc: 120 });
  assert.equal(s.ui().entete, ENTETES.ARRET);
  assert.equal(s.ui().couleur, COULEURS.NEUTRE);
  assert.equal(s.ui().bas, 2, 'pas d\'allure à l\'arrêt');
});

test('allure lissée sur 30 s', () => {
  const s = seance();
  s.avancer(30, { vit: 12 });
  assert.ok(Math.abs(s.sorties.allure - 12 / 3.6) < 1e-6);
  assert.equal(s.ui().bas, 1);
  s.avancer(15, { vit: 6 });
  assert.ok(Math.abs(s.sorties.allure - 9 / 3.6) < 1e-6);
});

test('la parité de « ui » change à chaque seconde', () => {
  const s = seance();
  s.avancer(5);
  const parites = s.historique.map((h) => h.ui.parite);
  assert.deepEqual(parites, [1, 0, 1, 0, 1]);
});

test('traîne : 60 s avec la cible la plus haute après une montée', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.jusqua(ETATS.MONTEE, 60, { vz: 720, fc: 160 });
  s.avancer(120, { vz: 720, fc: 164 });
  const t = s.jusqua(ETATS.PLAT, 120, { vz: 0, fc: 164 });
  // 164 sur le plat (160) serait rouge ; pendant la traîne la cible est 165
  s.avancer(1, { fc: 164 });
  assert.equal(s.sorties.cible, 165);
  assert.equal(s.sorties.couleur, COULEURS.VERT);
  s.avancer(t + 60 - s.dur - 1, { fc: 164 });
  assert.equal(s.sorties.couleur, COULEURS.VERT, 'encore dans la traîne');
  s.avancer(1, { fc: 164 });
  assert.equal(s.sorties.cible, 160);
  assert.equal(s.sorties.couleur, COULEURS.ROUGE);
});

test('résumé de fin : 8 valeurs au plus, FC et temps par terrain', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(600, { fc: 150 });
  s.jusqua(ETATS.MONTEE, 60, { vz: 720, fc: 160 });
  s.avancer(1200, { vz: 720, fc: 160 });
  const r = s.app.getSummaryOutputs();
  assert.ok(r.length <= 8);
  const parId = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(parId.p.value, s.sorties.fp);
  assert.equal(parId.m.value, 160);
  assert.equal(parId.v.value, 720);
  assert.match(parId.m.postfix, /^bpm · 0h2\d$/);
  for (const x of r) {
    assert.ok(x.id.length === 1 && typeof x.name === 'string' && typeof x.format === 'string');
    assert.ok(Number.isFinite(x.value));
  }
});

test('résumé vide si la séance n\'a pas démarré', () => {
  const { App } = require('./sim/app');
  const app = new App();
  app.onLoad();
  app.evaluate({});
  assert.equal(app.getSummaryOutputs().length, 0);
});
