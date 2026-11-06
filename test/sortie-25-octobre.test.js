// Plan de test de la spec, « au simulateur » : rejeu de la reconnaissance
// du 25 octobre (4h23, 26,6 km, 1 516 m D+), extrait sans GPS.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { lireJournal, rejouer } = require('./sim/rejeu');
const A = require('./sim/analyse');

const journal = lireJournal(path.join(__dirname, 'fixtures', 'sortie-2026-10-25.json.gz'));
const { lignes, resume, app } = rejouer(journal);

test('1. le mur sort en MONTÉE du km 18,2 à 19,6', () => {
  const mur = A.partEntre(lignes, 18200, 19600, 1);
  assert.ok(mur.part >= 0.9, `${(mur.part * 100).toFixed(1)} % en MONTÉE`);
  // corps du mur, une fois la latence passée
  assert.equal(A.partEntre(lignes, 18400, 19550, 1).part, 1);
});

test('1. la descente à −24 % qui précède le mur sort en DESCENTE', () => {
  const d = A.partEntre(lignes, 16900, 18100, 2);
  assert.ok(d.part >= 0.9, `${(d.part * 100).toFixed(1)} % en DESCENTE`);
});

test('2. accord avec la pente réelle : plus de 90 % du temps, hors transitions', () => {
  const r = A.accord(lignes);
  assert.ok(r.total > 5000, `${r.total} s mesurées`);
  assert.ok(r.taux > 0.9, `accord ${(r.taux * 100).toFixed(1)} %`);
});

test('3. changements d\'état : quelques dizaines, pas des centaines', () => {
  const n = A.changements(lignes);
  const profil = A.changementsDuProfil(lignes);
  assert.ok(n < 100, `${n} changements`);
  // pas de papillonnement : du même ordre que les ondulations du profil réel
  assert.ok(n <= 1.5 * profil, `${n} changements pour ${profil} dans le profil`);
});

test('4. silence des alertes FC pendant les 10 premières minutes et à chaque arrêt', () => {
  const alertes = A.alertesFc(lignes);
  assert.ok(alertes.length > 0, 'des alertes existent sur cette sortie');
  for (const a of alertes) {
    assert.ok(a.dur >= 600, `alerte à ${a.dur} s`);
    assert.notEqual(a.etat, 3, `alerte en ARRÊT à ${a.dur} s`);
  }
  // vibrations : aucune indication « courte » ni triple « longue » avant 10 min
  const avant = lignes.filter((l) => l.dur < 600).flatMap((l) => l.indications);
  assert.ok(avant.every((x) => x === 'Interval'), 'seul le rappel boire peut vibrer');
  assert.ok(avant.length <= 1);
  // pendant les pauses de la montre, rien ne bouge
  for (const l of lignes.filter((x) => x.enPause)) assert.deepEqual(l.indications, []);
});

test('rappel boire toutes les 15 min de séance', () => {
  const boire = lignes.filter((l) => l.indications.length === 1 && Math.floor(l.ui / 2) % 11 === 7);
  const instants = boire.map((l) => l.dur);
  assert.deepEqual(instants.slice(0, 4), [900, 1800, 2700, 3600]);
});

test('résumé de fin cohérent avec les statistiques', () => {
  assert.ok(resume.length <= 8);
  const pe = A.parEtat(lignes);
  const parId = Object.fromEntries(resume.map((x) => [x.id, x]));
  assert.equal(parId.p.value, Math.round(app.variable('sommeFcT')[0] / app.variable('nFcT')[0]));
  // temps par terrain = temps passé dans chaque état, hors ARRÊT
  assert.deepEqual(Array.from(app.variable('tempsT')), [pe[0].temps, pe[1].temps, pe[2].temps]);
  // VAM moyenne plausible pour un trail en montée
  assert.ok(parId.v.value > 300 && parId.v.value < 1200, `VAM ${parId.v.value} m/h`);
});

test('mode minifié (comme sur la montre) : résultat identique seconde par seconde', () => {
  const minifie = rejouer(journal, { mode: 'minifie' });
  assert.equal(minifie.lignes.length, lignes.length);
  const champs = app.nomsSorties;
  for (let i = 0; i < lignes.length; i++) {
    for (const c of champs) {
      if (lignes[i][c] !== minifie.lignes[i][c]) {
        assert.fail(`seconde ${lignes[i].T}, sortie ${c} : ${lignes[i][c]} ≠ ${minifie.lignes[i][c]}`);
      }
    }
    assert.deepEqual(minifie.lignes[i].indications, lignes[i].indications);
  }
  assert.equal(JSON.stringify(minifie.resume), JSON.stringify(resume));
});

test('rejeu façon simulateur SuuntoPlus (pauses ignorées) : pas d\'erreur', () => {
  const sim = rejouer(journal, { pauses: false });
  assert.equal(sim.lignes.filter((l) => l.enPause).length, 0);
  assert.ok(A.accord(sim.lignes).taux > 0.9);
});
