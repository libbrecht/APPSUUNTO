// Outils : analyse d'un export de la montre (canaux de l'app) et rejeu.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { lireJournal, rejouer } = require('./sim/rejeu');
const { analyserExport } = require('../outils/analyser-export');

const FIXTURE = path.join(__dirname, 'fixtures', 'sortie-2026-10-25.json.gz');

// Fabrique un export comme celui de la montre : la sortie du 25 octobre,
// plus les échantillons ZappSample que l'app aurait écrits (valeur notée
// à chaque changement), et deux bascules de plan en cours de route.
function exportSimule() {
  const journal = lireJournal(FIXTURE);
  const canaux = ['etat', 'cible', 'couleur', 'plan'];
  const t0 = Date.parse(journal.Samples[0].TimeISO8601);
  const echantillons = [];
  const derniers = {};
  const { lignes, app } = rejouer(journal, {
    surSeconde: (l, a) => {
      if (l.dur === 7200 && !l.enPause && a.gabarit === 't') { a.onEvent(1); a.onEvent(2); }
      if (l.dur === 10800 && !l.enPause && a.gabarit === 't') { a.onEvent(1); a.onEvent(2); }
    }
  });
  for (const l of lignes) {
    canaux.forEach((c, k) => {
      if (!l.enPause && derniers[c] !== l[c]) {
        derniers[c] = l[c];
        echantillons.push({
          TimeISO8601: new Date(t0 + l.T * 1000 + 50).toISOString(),
          ZappSample: { ChannelId: 0x10 * 1 + k, Value: l[c] }
        });
      }
    });
  }
  return {
    journal: {
      ...journal,
      Samples: [...journal.Samples, ...echantillons],
      Zapps: [{
        Zapp: {
          Channels: canaux.map((c, k) => ({ ChannelId: 0x10 + k, VariableId: c, Name: c, Format: 'Count_Twodigits' })),
          HeaderId: 1,
          Id: 'zztroisc',
          Name: 'Trois Chiffres',
          SummaryOutputs: []
        }
      }]
    },
    app,
    lignes
  };
}

test('analyse d\'un export : FC et temps par terrain, bascules datées', () => {
  const { journal, app, lignes } = exportSimule();
  const r = analyserExport(journal);
  const temps = Array.from(app.variable('tempsT'));
  // à une seconde près par terrain (instant d'écriture des échantillons)
  r.parEtat.slice(0, 3).forEach((e, i) => assert.ok(Math.abs(e.temps - temps[i]) <= 2, `${e.nom} ${e.temps} / ${temps[i]}`));
  assert.ok(Math.abs(r.tempsRouge - app.variable('tempsRouge')) <= 2);
  assert.equal(r.bascules.length, 2);
  assert.deepEqual(r.bascules.map((b) => b.vers), ['B', 'A']);
  const ligne7200 = lignes.find((l) => l.dur === 7200 && !l.enPause);
  assert.ok(Math.abs(r.bascules[0].km - ligne7200.distance / 1000) < 0.05);
  assert.ok(r.accord.taux > 0.9);
});

test('analyse : erreur claire sans données de l\'app', () => {
  assert.throws(() => analyserExport(lireJournal(FIXTURE)), /Pas de données/);
});

test('outil de rejeu en ligne de commande', () => {
  const sortie = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'outils', 'rejouer.js'), FIXTURE,
    '--reglages', path.join(__dirname, '..', 'configurations', 'course-pichauris.json')
  ], { encoding: 'utf8' });
  assert.match(sortie, /Accord avec le profil réel \(hors transitions\) : 9\d\.\d %/);
  assert.match(sortie, /Résumé de fin/);
});
