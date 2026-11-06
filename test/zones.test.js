// Zones par distance : décalages, cibles et plafonds fixés, zone libre.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seance, ETATS, COULEURS, ENTETES } = require('./sim/scenario');

const PICHAURIS = '0-11.6 -4; 40.2-42.0 m163 a165; 44.7-99 libre';

// Cibles effectives (plat, montée, descente, plafond) au kilomètre km
function cibles(reglages, km) {
  const s = seance(reglages);
  s.avancer(1, { km });
  const v = (n) => s.app.variable(n);
  return [v('tgPlat'), v('tgMontee'), v('tgDescente'), v('tgPlafond'), v('libre')];
}

test('Pichauris : le départ retient 4 battements', () => {
  assert.deepEqual(cibles({ zones: PICHAURIS }, 5), [156, 161, 146, 167, 0]);
  assert.deepEqual(cibles({ zones: PICHAURIS }, 11.6), [156, 161, 146, 167, 0]);
  assert.deepEqual(cibles({ zones: PICHAURIS }, 11.7), [160, 165, 150, 167, 0]);
});

test('Pichauris : le mur est plafonné à 165', () => {
  assert.deepEqual(cibles({ zones: PICHAURIS }, 41), [160, 163, 150, 165, 0]);
  // en plan B, les mêmes valeurs fixées s'appliquent
  assert.deepEqual(cibles({ zones: PICHAURIS, plan_initial: '1' }, 41), [155, 163, 150, 165, 0]);
});

test('Pichauris : la descente finale est libre', () => {
  assert.equal(cibles({ zones: PICHAURIS }, 45)[4], 1);
  assert.equal(cibles({ zones: PICHAURIS }, 44.6)[4], 0);
});

test('zone libre : FC en blanc, en-tête « libre », statistiques gardées', () => {
  const s = seance({ zones: PICHAURIS, grace: '0' });
  s.avancer(120, { fc: 172, km: 46 });
  assert.equal(s.sorties.couleur, COULEURS.NEUTRE);
  assert.equal(s.ui().entete, ENTETES.LIBRE);
  assert.equal(s.sorties.fcm, 172);
  assert.equal(s.app.variable('nAlertes'), 0);
});

test('la cible affichée suit les zones', () => {
  const s = seance({ zones: PICHAURIS });
  assert.equal(s.avancer(1, { km: 5 }).cible, 156);
  assert.equal(s.avancer(1, { km: 20 }).cible, 160);
});

test('chevauchement : les tranches s\'appliquent dans l\'ordre (décalages cumulés)', () => {
  // grand froid ajouté devant : -3 partout, -7 au départ
  assert.deepEqual(cibles({ zones: '0-99 -3; ' + PICHAURIS }, 5).slice(0, 3), [153, 158, 143]);
  // la valeur fixée du mur, écrite après, l'emporte
  assert.equal(cibles({ zones: '0-99 -3; ' + PICHAURIS }, 41)[1], 163);
  // écrite avant le décalage global, elle est décalée
  assert.equal(cibles({ zones: PICHAURIS + '; 0-99 -3' }, 41)[1], 160);
});

test('tranche globale de température : 0-99 -3', () => {
  assert.deepEqual(cibles({ zones: '0-99 -3' }, 12), [157, 162, 147, 167, 0]);
});

test('saisies tolérées : virgule décimale, signe moins typographique, majuscules', () => {
  assert.deepEqual(cibles({ zones: '0-11,6 −4' }, 11.5).slice(0, 3), [156, 161, 146]);
  assert.deepEqual(cibles({ zones: '40.2-42 M163 A165' }, 41).slice(1, 4), [163, 150, 165]);
});

test('saisies invalides ignorées sans planter', () => {
  for (const z of ['n\'importe quoi', '5-x -4', '-4', ';;;', '1-2', '1-2 z99', '3-1 -4']) {
    assert.deepEqual(cibles({ zones: z }, 2), [160, 165, 150, 167, 0], z);
  }
});

test('au plus 12 tranches lues', () => {
  const z = Array.from({ length: 20 }, (_, i) => `${i}-${i + 1} -1`).join('; ');
  const s = seance({ zones: z });
  assert.equal(s.app.variable('nTranches'), 12);
});

test('cibles mal saisies : valeurs par défaut', () => {
  const s = seance({ cibles_A: '160 165', cibles_B: 'abc' });
  assert.deepEqual(Array.from(s.app.variable('cibA')), [160, 165, 150]);
  assert.deepEqual(Array.from(s.app.variable('cibB')), [155, 160, 150]);
  const t = seance({ cibles_A: '158,163,149' });
  assert.deepEqual(Array.from(t.app.variable('cibA')), [158, 163, 149]);
});

test('le terrain détecté choisit la cible de la zone', () => {
  const s = seance({ zones: PICHAURIS, grace: '0' });
  s.jusqua(ETATS.MONTEE, 60, { vz: 720, km: 41 });
  s.avancer(61, { vz: 720, km: 41, fc: 166 });
  assert.equal(s.sorties.cible, 163);
  // 166 : au-dessus de 163 + 3 et du plafond 165 → rouge
  assert.equal(s.sorties.couleur, COULEURS.ROUGE);
});
