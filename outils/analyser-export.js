#!/usr/bin/env node
// Analyse un export Suunto JSON d'une séance faite AVEC l'app sur la
// montre (SuuntoPlus Editor > Suunto Watch > workouts en JSON). L'app y
// enregistre chaque seconde le terrain, la cible, la couleur et le plan
// (échantillons « ZappSample », écrits quand la valeur change).
//
// Donne : FC et temps par terrain, temps au-dessus des cibles, bascules de
// plan (heure de séance et kilomètre), et l'accord entre le terrain
// détecté et le profil réel calculé sur l'altitude.
//
// Usage : node outils/analyser-export.js export.json[.gz]
'use strict';

const path = require('path');
const { lireJournal } = require('../test/sim/rejeu');
const A = require('../test/sim/analyse');

const VARIABLES = ['etat', 'cible', 'couleur', 'plan'];

// En-têtes des apps : « Zapps » au niveau du journal ou de l'en-tête,
// avec ou sans enveloppe { Zapp: {...} } selon les versions.
function enteteApp(journal) {
  const listes = [journal.Zapps, journal.Header && journal.Header.Zapps].filter(Array.isArray);
  for (const liste of listes) {
    for (const brut of liste) {
      const z = brut.Zapp || brut;
      const canaux = z.Channels || [];
      if (z.Name === 'Trois Chiffres' || canaux.some((c) => c.VariableId === 'etat')) return z;
    }
  }
  return null;
}

function analyserExport(journal) {
  const app = enteteApp(journal);
  if (!app) throw new Error('Pas de données de l\'app Trois Chiffres dans cet export');
  const parCanal = new Map((app.Channels || []).map((c) => [c.ChannelId, c.VariableId]));
  for (const v of VARIABLES) {
    if (![...parCanal.values()].includes(v)) throw new Error(`Canal « ${v} » absent de l'export`);
  }

  // Événements triés dans le temps
  const t0 = Date.parse(journal.Samples[0].TimeISO8601);
  const evenements = journal.Samples.map((s) => ({ t: (Date.parse(s.TimeISO8601) - t0) / 1000, s }))
    .sort((a, b) => a.t - b.t);

  // Rééchantillonnage à la seconde, valeurs tenues, pauses retirées
  const courant = {};
  const lignes = [];
  let enPause = false;
  let dur = 0;
  let i = 0;
  const fin = Math.ceil(evenements[evenements.length - 1].t);
  for (let T = 1; T <= fin; T++) {
    for (; i < evenements.length && evenements[i].t <= T; i++) {
      const s = evenements[i].s;
      for (const c of ['HR', 'Distance', 'Altitude']) if (typeof s[c] === 'number') courant[c] = s[c];
      if (s.ZappSample && parCanal.has(s.ZappSample.ChannelId)) {
        courant[parCanal.get(s.ZappSample.ChannelId)] = s.ZappSample.Value;
      }
      for (const e of s.Events || []) if (e.Pause) enPause = !!e.Pause.State;
    }
    if (enPause) continue;
    dur++;
    if (courant.etat === undefined) continue;
    lignes.push({
      dur,
      enPause: false,
      etat: Math.round(courant.etat),
      cible: courant.cible,
      couleur: Math.round(courant.couleur),
      plan: Math.round(courant.plan),
      fc: courant.HR !== undefined ? Math.round(courant.HR * 60) : 0,
      distance: courant.Distance,
      altitude: courant.Altitude
    });
  }

  const bascules = [];
  for (let k = 1; k < lignes.length; k++) {
    if (lignes[k].plan !== lignes[k - 1].plan) {
      bascules.push({ dur: lignes[k].dur, km: (lignes[k].distance || 0) / 1000, vers: lignes[k].plan === 2 ? 'B' : 'A' });
    }
  }
  return {
    nom: app.Name,
    parEtat: A.parEtat(lignes),
    tempsRouge: lignes.filter((l) => l.couleur === 3).length,
    bascules,
    accord: (() => {
      const avecAltitude = lignes.filter((l) => typeof l.altitude === 'number');
      return avecAltitude.length > 600 ? A.accord(avecAltitude) : null;
    })(),
    changements: A.changements(lignes),
    resume: app.SummaryOutputs || []
  };
}

module.exports = { analyserExport, enteteApp };

if (require.main === module) {
  const fichier = process.argv[2];
  if (!fichier) {
    console.error('Usage : node outils/analyser-export.js export.json[.gz]');
    process.exit(2);
  }
  const hms = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}'${String(Math.round(s % 60)).padStart(2, '0')}`;
  const r = analyserExport(lireJournal(fichier));
  console.log(`Export : ${path.basename(fichier)} — app ${r.nom}\n`);
  console.log('FC et temps par terrain (enregistrés par la montre) :');
  for (const e of r.parEtat) console.log(`  ${e.nom.padEnd(9)} ${hms(e.temps).padStart(10)}   ${e.fc ? Math.round(e.fc) + ' bpm' : '--'}`);
  console.log(`\nTemps au-dessus des cibles : ${hms(r.tempsRouge)}`);
  console.log(`Changements de terrain : ${r.changements}`);
  if (r.accord) console.log(`Accord avec le profil réel : ${(r.accord.taux * 100).toFixed(1)} % sur ${r.accord.total} s`);
  console.log(`\nBascules de plan : ${r.bascules.length}`);
  for (const b of r.bascules) console.log(`  ${hms(b.dur)}  km ${b.km.toFixed(2)}  → plan ${b.vers}`);
  if (r.resume.length) {
    console.log('\nRésumé de fin :');
    for (const s of r.resume) console.log(`  ${s.Name}: ${s.SummaryValue} ${s.Postfix || ''}`);
  }
}
