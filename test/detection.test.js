// Détection du terrain : machine à états, hystérésis, persistance, arrêt.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seance, ETATS } = require('./sim/scenario');

const { PLAT, MONTEE, DESCENTE, ARRET } = ETATS;

const etats = (s) => s.historique.map((h) => h.etat);
const changements = (s) => {
  let n = 0;
  const e = etats(s);
  for (let i = 1; i < e.length; i++) if (e[i] !== e[i - 1]) n++;
  return n;
};

test('latence d\'une montée franche (+720 m/h) : 25 à 30 s', () => {
  const s = seance();
  s.avancer(60);
  const debut = s.dur;
  const t = s.jusqua(MONTEE, 60, { vz: 720 });
  const latence = t - debut;
  assert.ok(latence >= 25 && latence <= 30, `latence ${latence} s`);
});

test('table de la spec : plat roulant ±160 m/h reste PLAT', () => {
  const s = seance();
  s.avancer(1800, { vz: (t) => 160 * Math.sin((2 * Math.PI * t) / 90) });
  assert.ok(etats(s).every((e) => e === PLAT));
});

test('table de la spec : faux plat montant +320 m/h → MONTÉE', () => {
  const s = seance();
  s.avancer(120, { vz: 320 });
  assert.equal(s.sorties.etat, MONTEE);
});

test('table de la spec : descente roulante −540 m/h → DESCENTE', () => {
  const s = seance();
  s.avancer(120, { vz: -540 });
  assert.equal(s.sorties.etat, DESCENTE);
});

test('hystérésis : la montée tient entre +150 et +300, puis sort sous +150', () => {
  const s = seance();
  s.jusqua(MONTEE, 60, { vz: 720 });
  s.avancer(600, { vz: 200 });
  assert.ok(s.historique.slice(-600).every((h) => h.etat === MONTEE));
  s.avancer(19, { vz: 100 });
  assert.equal(s.sorties.etat, MONTEE, 'pas avant la persistance');
  s.avancer(30, { vz: 100 });
  assert.equal(s.sorties.etat, PLAT);
});

test('hystérésis : la descente tient entre −300 et −150', () => {
  const s = seance();
  s.jusqua(DESCENTE, 60, { vz: -720 });
  s.avancer(600, { vz: -200 });
  assert.equal(s.sorties.etat, DESCENTE);
  s.avancer(60, { vz: -100 });
  assert.equal(s.sorties.etat, PLAT);
});

test('col sans plat : MONTÉE → DESCENTE directement', () => {
  const s = seance();
  s.jusqua(MONTEE, 60, { vz: 720 });
  s.avancer(120, { vz: 720 });
  const avant = s.historique.length;
  s.jusqua(DESCENTE, 60, { vz: -720 });
  const pendant = s.historique.slice(avant).map((h) => h.etat);
  assert.ok(!pendant.includes(PLAT), 'aucun passage par PLAT');
});

test('creux sans plat : DESCENTE → MONTÉE directement', () => {
  const s = seance();
  s.jusqua(DESCENTE, 60, { vz: -720 });
  s.avancer(120, { vz: -720 });
  const avant = s.historique.length;
  s.jusqua(MONTEE, 60, { vz: 720 });
  assert.ok(!s.historique.slice(avant).some((h) => h.etat === PLAT));
});

test('bosses de moins de 20 s sur terrain roulant : l\'état reste PLAT', () => {
  const s = seance();
  s.avancer(60); // la moyenne glissante a 15 s d'historique
  s.avancer(1800, { vz: (t) => (t % 90 < 15 ? 720 : -150) });
  assert.ok(etats(s).every((e) => e === PLAT), `${changements(s)} changements`);
});

test('rampe raide de 15 s (+720 m/h) : non détectée', () => {
  const s = seance();
  s.avancer(60);
  s.avancer(15, { vz: 720 });
  s.avancer(120, { vz: 0 });
  assert.ok(etats(s).every((e) => e === PLAT));
});

test('rampe raide de 25 s : FC au rouge sur la cible plat, mais pas d\'alerte', () => {
  // La spec : « Le rouge n'alerte qu'après 45 s : la rampe est finie avant ».
  // FC qui grimpe de 150 à 166 (rouge dès 164, sous le plafond 167), puis
  // redescend une fois la rampe finie.
  const s = seance({ grace: '0' });
  s.avancer(120, { fc: 150 });
  const debut = s.dur;
  s.avancer(25, { vz: 1200, fc: (t) => Math.min(166, 150 + (t - debut)) });
  s.avancer(120, { vz: 0, fc: (t) => Math.max(150, 166 - (t - debut - 25)) });
  assert.ok(s.historique.some((h) => h.couleur === 3), 'la FC passe bien au rouge');
  assert.equal(s.app.variable('nAlertes'), 0);
  assert.ok(!s.app.indications.some((x) => x.nom === 'Info'));
});

test('saut d\'altitude (recalage baro-GPS) : pic rejeté au-delà de ±4 000 m/h', () => {
  const s = seance();
  s.avancer(60);
  s.avancer(1, { vz: 30000 });
  s.avancer(1, { vz: -9000 });
  s.avancer(120);
  assert.ok(etats(s).every((e) => e === PLAT));
});

test('arrêt photo en pleine montée : ARRÊT en 10 s, retour en MONTÉE en 5 s', () => {
  const s = seance();
  s.jusqua(MONTEE, 60, { vz: 720 });
  s.avancer(60, { vz: 720 });
  // à l'arrêt : vitesse nulle, vitesse verticale qui retombe à zéro
  const debut = s.dur;
  const t = s.jusqua(ARRET, 60, { vz: 0, vit: 0 });
  // la moyenne glissante doit d'abord retomber sous 100 m/h (≈ 13 s), puis 10 s
  assert.ok(t - debut <= 25, `entrée en ARRÊT après ${t - debut} s`);
  s.avancer(120, { vz: 0, vit: 0 });
  assert.equal(s.sorties.etat, ARRET);
  s.avancer(4, { vz: 720, vit: 4 });
  assert.equal(s.sorties.etat, ARRET, 'pas avant 5 s');
  s.avancer(1, { vz: 720, vit: 4 });
  assert.equal(s.sorties.etat, MONTEE, 'retour à l\'état précédent, pas en PLAT');
});

test('bouchon sur sentier étroit : l\'ARRÊT ne clignote pas', () => {
  const s = seance();
  s.avancer(60);
  s.jusqua(ARRET, 30, { vit: 0.5 });
  const avant = s.historique.length;
  s.avancer(300, { vit: (t) => (t % 4 < 2 ? 1.5 : 0.5) });
  assert.ok(s.historique.slice(avant).every((h) => h.etat === ARRET));
  s.avancer(5, { vit: 3 });
  assert.equal(s.sorties.etat, PLAT);
});

test('GPS perdu (vitesse absente) : pas d\'arrêt fantôme', () => {
  const s = seance();
  s.avancer(300, { vit: null });
  assert.ok(etats(s).every((e) => e === PLAT));
});

test('pause de la montre : à la reprise, état remis à PLAT et traîne effacée', () => {
  const s = seance();
  s.jusqua(MONTEE, 60, { vz: 720 });
  s.avancer(30, { vz: 720 });
  const tempsMontee = s.sorties.tm;
  s.app.onExercisePause();
  // pendant la pause, evaluate continue d'être appelé mais rien n'avance
  for (let i = 0; i < 30; i++) s.app.evaluate({ hr: 2.5, vz: 0.2, spd: 2, dist: s.distance, dur: s.dur });
  assert.equal(s.app.sorties().tm, tempsMontee, 'statistiques gelées pendant la pause');
  s.app.onExerciseContinue();
  s.avancer(1, { vz: 720 });
  assert.equal(s.sorties.etat, PLAT);
  assert.equal(s.app.variable('traineFin'), 0);
});

test('seuils et persistance réglables', () => {
  const s = seance({ seuils_vz: '500 200', persistance: '10' });
  s.avancer(120, { vz: 400 });
  assert.equal(s.sorties.etat, PLAT, '400 m/h sous le seuil de 500');
  const debut = s.dur;
  const t = s.jusqua(MONTEE, 60, { vz: 900 });
  assert.ok(t - debut <= 20, `persistance de 10 s : ${t - debut} s`);
});

test('seuils incohérents : valeurs par défaut', () => {
  const s = seance({ seuils_vz: '100 300' });
  assert.equal(s.app.variable('seuilEntree'), 300);
  assert.equal(s.app.variable('seuilSortie'), 150);
});
