// Alertes : FC haute, plafond absolu, boire, capteur FC, et leurs silences.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seance, ETATS, COULEURS, ENTETES } = require('./sim/scenario');

const COURTE = 'Info';
const LONGUE = 'Interval';

// Instants (en s de séance) où une indication donnée a été jouée
const instants = (s, nom) => s.app.indications.filter((x) => x.nom === nom).map((x) => x.tic);

test('période de grâce : aucune alerte FC pendant les 10 premières minutes', () => {
  // FC 165 : rouge sur la cible plat A (160 + 3), sous le plafond 167
  const s = seance({ boire: '0' });
  s.avancer(700, { fc: 165 });
  // alertes permises dès 600 s ; 45 s de rouge = secondes 600 à 644
  assert.deepEqual(instants(s, COURTE), [644, 645], '2 courtes après 10 min + 45 s de rouge');
  assert.ok(s.historique.slice(0, 600).every((h) => h.couleur === COULEURS.ROUGE),
    'les couleurs restent actives pendant la grâce');
});

test('FC haute : 2 courtes après 45 s de rouge, puis toutes les 3 min', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(420, { fc: 165 });
  assert.deepEqual(instants(s, COURTE), [45, 46, 225, 226, 405, 406]);
  assert.equal(s.app.variable('nAlertes'), 3);
});

test('FC haute : le compteur repart si le rouge s\'interrompt', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(40, { fc: 165 });
  s.avancer(5, { fc: 158 });
  s.avancer(44, { fc: 165 });
  assert.deepEqual(instants(s, COURTE), []);
  s.avancer(1, { fc: 165 });
  assert.deepEqual(instants(s, COURTE), [90]);
});

test('délai d\'alerte réglable', () => {
  const s = seance({ grace: '0', boire: '0', delai_alerte: '20' });
  s.avancer(30, { fc: 165 });
  assert.deepEqual(instants(s, COURTE), [20, 21]);
});

test('plafond absolu : 3 longues après 15 s, au plus toutes les 2 min, sans double alerte', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(300, { fc: 170 });
  assert.deepEqual(instants(s, LONGUE), [15, 16, 17, 135, 136, 137, 255, 256, 257]);
  assert.deepEqual(instants(s, COURTE), [], 'pas d\'alerte FC haute en plus');
  assert.equal(s.historique[16].ui.entete, ENTETES.PLAFOND, 'message affiché 6 s');
});

test('plafond qui clignote autour de la limite : au plus une alerte toutes les 2 min', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(600, { fc: (t) => (t % 40 < 20 ? 170 : 160) });
  const t = instants(s, LONGUE).filter((x, i, a) => i === 0 || x - a[i - 1] > 2);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 120, `écart ${t[i] - t[i - 1]} s`);
});

test('après une alerte plafond, la FC haute ne revient pas avant 3 min', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(20, { fc: 170 }); // alerte plafond à 15 s
  s.avancer(300, { fc: 165 }); // reste rouge sous le plafond
  assert.deepEqual(instants(s, COURTE), [195, 196]);
});

test('boire : 1 longue toutes les 15 min, même en ARRÊT ; 0 désactive', () => {
  const s = seance({ grace: '0' });
  s.avancer(1000, { fc: 140 });
  s.avancer(1000, { fc: 140, vit: 0 });
  assert.equal(s.sorties.etat, ETATS.ARRET);
  assert.deepEqual(instants(s, LONGUE), [900, 1800]);
  assert.equal(s.historique[902].ui.entete, ENTETES.BOIRE);

  const sans = seance({ grace: '0', boire: '0' });
  sans.avancer(2000, { fc: 140 });
  assert.deepEqual(instants(sans, LONGUE), []);
});

test('capteur FC : 1 longue après 2 min sans FC, une fois par coupure', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(100, { fc: 150 });
  s.avancer(300, { fc: null });
  assert.equal(s.sorties.fc, 0, 'FC affichée « -- »');
  assert.equal(s.sorties.couleur, COULEURS.NEUTRE);
  s.avancer(100, { fc: 150 });
  s.avancer(200, { fc: null });
  assert.deepEqual(instants(s, LONGUE), [220, 620]);
  assert.equal(s.historique[221].ui.entete, ENTETES.CAPTEUR);
});

test('pas de FC du tout au départ : alerte capteur à 2 min', () => {
  const s = seance({ boire: '0' });
  s.avancer(130, { fc: null });
  assert.deepEqual(instants(s, LONGUE), [120]);
});

test('trous de FC ignorés dans les moyennes', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(100, { fc: 150 });
  s.avancer(100, { fc: null });
  s.avancer(100, { fc: 150 });
  assert.equal(s.sorties.fcm, 150);
  assert.equal(s.sorties.fp, 150);
  assert.equal(s.sorties.tp, 300, 'le temps compte, lui');
});

test('pic de FC aberrant : rejeté (affichage tenu, statistiques intactes)', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(60, { fc: 150 });
  assert.equal(s.avancer(1, { fc: 205 }).fc, 150);
  assert.equal(s.avancer(1, { fc: 150 }).fc, 150);
  assert.equal(s.sorties.fcm, 150);
  // une vraie hausse durable passe au bout de 3 s
  s.avancer(3, { fc: 175 });
  assert.equal(s.sorties.fc, 175);
});

test('aucune alerte FC en ARRÊT', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(60, { fc: 150 });
  s.avancer(600, { fc: 175, vit: 0 });
  assert.equal(s.sorties.etat, ETATS.ARRET);
  assert.equal(s.app.variable('nAlertes'), 0);
  assert.ok(s.historique.slice(-500).every((h) => h.couleur === COULEURS.NEUTRE));
});

test('aucune alerte FC en zone libre, statistiques conservées', () => {
  const s = seance({ grace: '0', boire: '0', zones: '0-99 libre' });
  s.avancer(600, { fc: 175 });
  assert.equal(s.app.variable('nAlertes'), 0);
  assert.equal(s.sorties.couleur, COULEURS.NEUTRE);
  assert.equal(s.ui().entete, ENTETES.LIBRE);
  assert.equal(s.sorties.fcm, 175);
  assert.equal(s.sorties.tr, 0, 'pas de temps « rouge » sans jugement');
});

test('bascule de plan : alertes FC suspendues 60 s', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(30, { fc: 160 });
  s.app.onEvent(1);
  s.app.onEvent(2); // plan B : rouge dès 159 sur le plat
  s.avancer(120, { fc: 161 });
  // bascule à 30 s : suspension jusqu'à 90 s, puis 45 s de rouge (90 à 134)
  assert.deepEqual(instants(s, COURTE), [134, 135]);
});

test('temps au-dessus des cibles : somme des secondes en rouge', () => {
  const s = seance({ grace: '0', boire: '0' });
  s.avancer(100, { fc: 150 });
  s.avancer(50, { fc: 165 });
  s.avancer(100, { fc: 150 });
  assert.equal(s.sorties.tr, 50);
});
