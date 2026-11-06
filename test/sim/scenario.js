// Scénarios synthétiques : on pilote l'app seconde par seconde avec des
// entrées exprimées dans des unités lisibles (bpm, m/h, km/h, km).
'use strict';

const { App } = require('./app');

const ETATS = { PLAT: 0, MONTEE: 1, DESCENTE: 2, ARRET: 3 };
const COULEURS = { GRIS: 0, VERT: 1, ORANGE: 2, ROUGE: 3, NEUTRE: 4 };
const ENTETES = {
  PLAT: 0, MONTEE: 1, DESCENTE: 2, ARRET: 3, LIBRE: 4, FC_HAUTE: 5, PLAFOND: 6,
  BOIRE: 7, CAPTEUR: 8, PLAN_A: 9, PLAN_B: 10
};

// Décode la sortie « ui » (voir paquetUi dans main.js et t.html)
function decoderUi(v) {
  let u = Math.floor(v / 2);
  const entete = u % 11;
  u = Math.floor(u / 11);
  const couleur = u % 5;
  u = Math.floor(u / 5);
  const bas = u % 3;
  const plan = Math.floor(u / 3) % 2;
  return { parite: v % 2, entete, couleur, bas, plan };
}

const valeur = (x, t) => (typeof x === 'function' ? x(t) : x);

// Démarre une séance. Options d'entrée par défaut : FC 140 bpm, vz 0 m/h,
// 8 km/h ; la distance avance avec la vitesse sauf si « km » est fourni.
function seance(reglages = {}, { mode = 'source' } = {}) {
  const app = new App({ reglages, mode });
  app.onLoad();
  app.onExerciseStart();
  const s = {
    app,
    dur: 0,
    distance: 0,
    sorties: null,
    historique: [],
    // entrees : { fc, vz, vit, km } (valeurs ou fonctions de la durée) ;
    // fc à null = pas de FC.
    avancer(n, entrees = {}) {
      const e = { fc: 140, vz: 0, vit: 8, ...entrees };
      for (let i = 0; i < n; i++) {
        s.dur += 1;
        const vit = valeur(e.vit, s.dur);
        if (e.km !== undefined) s.distance = valeur(e.km, s.dur) * 1000;
        else if (typeof vit === 'number') s.distance += vit / 3.6;
        const fc = valeur(e.fc, s.dur);
        const vz = valeur(e.vz, s.dur);
        s.sorties = app.evaluate({
          hr: fc === null || fc === undefined ? undefined : fc / 60,
          vz: vz === null || vz === undefined ? undefined : vz / 3600,
          spd: vit === null || vit === undefined ? undefined : vit / 3.6,
          dist: s.distance,
          dur: s.dur
        });
        s.historique.push({ dur: s.dur, ...s.sorties, ui: decoderUi(s.sorties.ui) });
      }
      return s.sorties;
    },
    // Avance jusqu'à ce que l'état demandé soit atteint (ou échoue)
    jusqua(etat, max, entrees) {
      for (let i = 0; i < max; i++) {
        if (s.avancer(1, entrees).etat === etat) return s.dur;
      }
      throw new Error(`état ${etat} non atteint en ${max} s`);
    },
    // Indications (vibrations) jouées depuis l'instant t (en tics)
    indicationsDepuis(tic) {
      return app.indications.filter((x) => x.tic > tic);
    },
    ui() {
      return decoderUi(s.sorties.ui);
    }
  };
  return s;
}

module.exports = { seance, decoderUi, ETATS, COULEURS, ENTETES };
