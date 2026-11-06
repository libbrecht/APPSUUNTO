// Mesures du plan de test de la spec sur un rejeu (lignes de rejouer()).
'use strict';

const NOMS_ETATS = ['PLAT', 'MONTÉE', 'DESCENTE', 'ARRÊT'];

// Secondes de séance (hors pauses de la montre)
const enCourse = (lignes) => lignes.filter((l) => !l.enPause);

// Terrain « réel », calculé après coup sur l'altitude : vitesse verticale
// centrée sur ±fenetre secondes. ≥ +300 m/h montée, ≤ −300 descente,
// |v| ≤ 150 plat ; entre 150 et 300, ambigu (exclu de la mesure).
function terrainReel(lignes, fenetre = 30) {
  const n = lignes.length;
  return lignes.map((l, i) => {
    const a = Math.max(0, i - fenetre);
    const b = Math.min(n - 1, i + fenetre);
    const v = b > a ? (lignes[b].altitude - lignes[a].altitude) / (b - a) * 3600 : 0;
    if (v >= 300) return 1;
    if (v <= -300) return 2;
    if (Math.abs(v) <= 150) return 0;
    return -1;
  });
}

// Accord entre l'état détecté et le terrain réel, hors transitions
// (± marge secondes autour de chaque changement du terrain réel), hors
// zones ambiguës et hors ARRÊT.
function accord(lignesBrutes, { fenetre = 30, marge = 45 } = {}) {
  const lignes = enCourse(lignesBrutes);
  const reel = terrainReel(lignes, fenetre);
  const exclu = new Array(lignes.length).fill(false);
  let precedent = null;
  reel.forEach((e, i) => {
    if (e < 0) return;
    if (precedent !== null && e !== precedent) {
      for (let k = Math.max(0, i - marge); k <= Math.min(lignes.length - 1, i + marge); k++) exclu[k] = true;
    }
    precedent = e;
  });
  let ok = 0;
  let total = 0;
  const confusion = {};
  lignes.forEach((l, i) => {
    const r = reel[i];
    if (r < 0 || exclu[i] || l.etat === 3) return;
    total++;
    if (r === l.etat) ok++;
    const cle = `${NOMS_ETATS[r]} → ${NOMS_ETATS[l.etat]}`;
    confusion[cle] = (confusion[cle] || 0) + 1;
  });
  return { ok, total, taux: total ? ok / total : 0, confusion };
}

// Nombre de changements d'état détectés
function changements(lignesBrutes) {
  const lignes = enCourse(lignesBrutes);
  let n = 0;
  for (let i = 1; i < lignes.length; i++) if (lignes[i].etat !== lignes[i - 1].etat) n++;
  return n;
}

// Même machine (hystérésis + persistance) appliquée au terrain réel
// lissé après coup : combien de changements le profil lui-même contient.
function changementsDuProfil(lignesBrutes, { fenetre = 30, persistance = 20 } = {}) {
  const lignes = enCourse(lignesBrutes);
  const n = lignes.length;
  let etat = 0;
  let voulu = -1;
  let attente = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - fenetre);
    const b = Math.min(n - 1, i + fenetre);
    const v = (lignes[b].altitude - lignes[a].altitude) / Math.max(1, b - a) * 3600;
    let w = 0;
    if (v >= 300) w = 1;
    else if (v <= -300) w = 2;
    else if (etat === 1 && v > 150) w = 1;
    else if (etat === 2 && v < -150) w = 2;
    if (w === etat) attente = 0;
    else {
      attente = w === voulu ? attente + 1 : 1;
      voulu = w;
    }
    if (attente >= persistance) {
      etat = w;
      attente = 0;
      total++;
    }
  }
  return total;
}

// Part du temps passé dans l'état attendu entre deux distances (m)
function partEntre(lignesBrutes, de, a, etat) {
  const l = enCourse(lignesBrutes).filter((x) => x.distance >= de && x.distance <= a);
  return { n: l.length, part: l.length ? l.filter((x) => x.etat === etat).length / l.length : 0 };
}

// Alertes FC (FC haute, plafond) relevées dans les lignes : un message
// d'alerte qui apparaît dans l'en-tête de l'écran (sortie ui)
function alertesFc(lignesBrutes) {
  const res = [];
  let precedent = -1;
  for (const l of lignesBrutes) {
    const entete = Math.floor(l.ui / 2) % 11;
    if ((entete === 5 || entete === 6) && entete !== precedent) {
      res.push({ dur: l.dur, type: entete === 5 ? 'FC haute' : 'plafond', etat: l.etat, km: l.distance / 1000 });
    }
    precedent = entete;
  }
  return res;
}

// Temps et FC moyenne par état (hors pauses)
function parEtat(lignesBrutes) {
  const t = [0, 0, 0, 0];
  const s = [0, 0, 0, 0];
  const n = [0, 0, 0, 0];
  for (const l of enCourse(lignesBrutes)) {
    t[l.etat]++;
    if (l.fc > 0) {
      s[l.etat] += l.fc;
      n[l.etat]++;
    }
  }
  return NOMS_ETATS.map((nom, i) => ({ nom, temps: t[i], fc: n[i] ? s[i] / n[i] : 0 }));
}

module.exports = { NOMS_ETATS, enCourse, terrainReel, accord, changements, changementsDuProfil, partEntre, alertesFc, parEtat };
