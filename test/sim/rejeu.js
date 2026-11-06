// Rejeu d'un export Suunto JSON (DeviceLog) à travers l'app, seconde par
// seconde, comme sur la montre :
//  - les échantillons sont « tenus » (dernière valeur connue), comme dans
//    le simulateur de SuuntoPlus Editor ;
//  - evaluate() est appelé chaque seconde, y compris en pause ;
//  - la durée de séance (entrée « dur ») n'avance pas pendant les pauses ;
//  - les événements Pause du fichier déclenchent onExercisePause /
//    onExerciseContinue (option pauses: false pour imiter le simulateur,
//    qui les ignore).
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { App } = require('./app');

function lireJournal(fichier) {
  let donnees = fs.readFileSync(fichier);
  if (fichier.endsWith('.gz')) donnees = zlib.gunzipSync(donnees);
  const journal = JSON.parse(donnees.toString('utf8')).DeviceLog;
  if (!journal || !Array.isArray(journal.Samples)) throw new Error('Fichier Suunto JSON (DeviceLog) attendu');
  return journal;
}

// Échantillons triés avec leur instant relatif (s) et la liste des pauses
function preparer(journal) {
  const t0 = Date.parse(journal.Samples[0].TimeISO8601);
  const echantillons = [];
  const pauses = [];
  for (const s of journal.Samples) {
    const t = (Date.parse(s.TimeISO8601) - t0) / 1000;
    if (Array.isArray(s.Events)) {
      for (const e of s.Events) {
        if (e.Pause) pauses.push({ t, enPause: !!e.Pause.State });
      }
    }
    const v = {};
    for (const c of ['HR', 'Distance', 'Speed', 'VerticalSpeed', 'Altitude']) {
      if (typeof s[c] === 'number') v[c] = s[c];
    }
    if (Object.keys(v).length) echantillons.push({ t, ...v });
  }
  echantillons.sort((a, b) => a.t - b.t);
  pauses.sort((a, b) => a.t - b.t);
  return { echantillons, pauses, duree: echantillons.length ? echantillons[echantillons.length - 1].t : 0 };
}

// Rejoue le journal. Renvoie une ligne par seconde d'horloge.
function rejouer(journal, { reglages = {}, mode = 'source', pauses = true, ticsAvantDepart = 3, surSeconde } = {}) {
  const app = new App({ reglages, mode });
  const { echantillons, pauses: listePauses, duree } = preparer(journal);
  const courant = {};
  let iEch = 0;
  let iPause = 0;
  let enPause = false;
  let dureeSeance = 0;
  const lignes = [];

  app.onLoad();
  for (let i = 0; i < ticsAvantDepart; i++) app.evaluate({});
  app.onExerciseStart();

  const fin = Math.ceil(duree);
  for (let T = 1; T <= fin; T++) {
    while (iEch < echantillons.length && echantillons[iEch].t <= T) {
      Object.assign(courant, echantillons[iEch]);
      iEch++;
    }
    while (pauses && iPause < listePauses.length && listePauses[iPause].t <= T) {
      const p = listePauses[iPause++];
      if (p.enPause && !enPause) {
        enPause = true;
        app.onExercisePause();
      } else if (!p.enPause && enPause) {
        enPause = false;
        app.onExerciseContinue();
      }
    }
    if (!enPause) dureeSeance += 1;
    const avant = app.indications.length;
    const o = app.evaluate({
      hr: courant.HR,
      vz: courant.VerticalSpeed,
      spd: courant.Speed,
      dist: courant.Distance,
      dur: dureeSeance
    });
    const ligne = {
      T,
      dur: dureeSeance,
      enPause,
      fcBrute: courant.HR !== undefined ? courant.HR * 60 : undefined,
      vzBrute: courant.VerticalSpeed !== undefined ? courant.VerticalSpeed * 3600 : undefined,
      vitesse: courant.Speed,
      distance: courant.Distance,
      altitude: courant.Altitude,
      indications: app.indications.slice(avant).map((x) => x.nom),
      ...o
    };
    lignes.push(ligne);
    if (surSeconde) surSeconde(ligne, app);
  }
  app.onExerciseEnd();
  return { app, lignes, resume: app.getSummaryOutputs() };
}

module.exports = { lireJournal, preparer, rejouer };
