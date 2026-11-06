#!/usr/bin/env node
// Rejoue une sortie (export Suunto JSON, éventuellement .gz) à travers
// l'app Trois Chiffres, comme sur la montre, et affiche le bilan du plan
// de test : détection du terrain, accord avec le profil réel, changements
// d'état, alertes, statistiques par terrain et résumé de fin.
//
// Usage :
//   node outils/rejouer.js sortie.json [--reglages fichier.json]
//        [--csv sortie.csv] [--simulateur] [--minifie]
//
//   --reglages   réglages à utiliser (par défaut TroisChiffres/data.json),
//                par exemple configurations/course-pichauris.json
//   --csv        écrit l'état de l'app seconde par seconde
//   --simulateur ignore les pauses, comme le simulateur SuuntoPlus
//   --minifie    exécute main.js transformé comme sur la montre
'use strict';

const fs = require('fs');
const path = require('path');
const { lireJournal, rejouer } = require('../test/sim/rejeu');
const A = require('../test/sim/analyse');

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
};
const fichier = args.find((a, i) => !a.startsWith('--') && !['--reglages', '--csv'].includes(args[i - 1]));
if (!fichier) {
  console.error('Usage : node outils/rejouer.js sortie.json [--reglages f.json] [--csv f.csv] [--simulateur] [--minifie]');
  process.exit(2);
}

const reglages = option('--reglages') ? JSON.parse(fs.readFileSync(option('--reglages'), 'utf8')) : {};
const journal = lireJournal(fichier);
const { lignes, resume } = rejouer(journal, {
  reglages,
  pauses: !args.includes('--simulateur'),
  mode: args.includes('--minifie') ? 'minifie' : 'source'
});

const hms = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = Math.round(s % 60);
  return `${h}h${String(m).padStart(2, '0')}'${String(x).padStart(2, '0')}`;
};
const pct = (x) => `${(x * 100).toFixed(1)} %`;

const course = A.enCourse(lignes);
const fin = course[course.length - 1] || {};
console.log(`Sortie : ${path.basename(fichier)} — ${hms(fin.dur || 0)} de séance, ${((fin.distance || 0) / 1000).toFixed(1)} km`);
console.log(`Réglages : ${option('--reglages') || 'TroisChiffres/data.json'}`);
console.log('');

console.log('Temps et FC moyenne par état :');
for (const e of A.parEtat(lignes)) {
  console.log(`  ${e.nom.padEnd(9)} ${hms(e.temps).padStart(10)}   ${e.fc ? Math.round(e.fc) + ' bpm' : '--'}`);
}
console.log('');

const acc = A.accord(lignes);
console.log(`Accord avec le profil réel (hors transitions) : ${pct(acc.taux)} sur ${acc.total} s (objectif > 90 %)`);
for (const [k, v] of Object.entries(acc.confusion).sort((a, b) => b[1] - a[1])) {
  console.log(`    réel ${k.padEnd(22)} ${v} s`);
}
console.log(`Changements d'état : ${A.changements(lignes)} (le profil lissé après coup en compte ${A.changementsDuProfil(lignes)})`);
console.log('');

const alertes = A.alertesFc(lignes);
console.log(`Alertes FC : ${alertes.length}`);
for (const a of alertes) {
  console.log(`  ${hms(a.dur)}  km ${a.km.toFixed(2).padStart(6)}  ${a.type}`);
}
console.log('');

console.log('Résumé de fin (tel qu\'enregistré par la montre) :');
for (const r of resume) {
  const v = r.format.startsWith('Duration') ? hms(r.value) : r.value;
  console.log(`  ${r.name.padEnd(16)} ${String(v).padStart(10)} ${r.postfix || ''}`);
}

const csv = option('--csv');
if (csv) {
  const colonnes = ['dur', 'distance', 'altitude', 'fcBrute', 'vzBrute', 'etat', 'cible', 'couleur', 'plan',
    'fc', 'fcm', 'vam', 'allure', 'tr'];
  const texte = [colonnes.join(';')]
    .concat(course.map((l) => colonnes.map((c) => (l[c] === undefined ? '' : l[c])).join(';')))
    .join('\n');
  fs.writeFileSync(csv, texte + '\n');
  console.log(`\nCSV écrit : ${csv} (${course.length} lignes)`);
}
