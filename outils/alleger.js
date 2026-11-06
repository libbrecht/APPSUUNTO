#!/usr/bin/env node
// Allège un export Suunto JSON (DeviceLog) pour les tests : ne garde que
// ce que lit l'app (FC, vitesse verticale, vitesse, distance, altitude) et
// les événements de pause/tour. Supprime les coordonnées GPS, le numéro
// de série et le reste. La sortie reste un fichier Suunto JSON valide que
// le simulateur SuuntoPlus sait rejouer (une fois décompressé si .gz).
//
// Usage : node outils/alleger.js entree.json sortie.json[.gz]
'use strict';

const fs = require('fs');
const zlib = require('zlib');

const [, , entree, sortie] = process.argv;
if (!entree || !sortie) {
  console.error('Usage : node outils/alleger.js entree.json sortie.json[.gz]');
  process.exit(2);
}

const log = JSON.parse(fs.readFileSync(entree, 'utf8')).DeviceLog;
const CHAMPS = ['HR', 'Distance', 'Speed', 'VerticalSpeed', 'Altitude'];

const samples = [];
for (const s of log.Samples) {
  const garde = { TimeISO8601: s.TimeISO8601 };
  let utile = false;
  for (const c of CHAMPS) {
    if (c in s) {
      garde[c] = s[c];
      utile = true;
    }
  }
  if (Array.isArray(s.Events)) {
    const ev = s.Events.filter((e) => e.Pause || e.Lap);
    if (ev.length) {
      garde.Events = ev;
      utile = true;
    }
  }
  if (utile) samples.push(garde);
}

const h = log.Header;
const resultat = {
  DeviceLog: {
    Header: {
      ActivityType: h.ActivityType,
      DateTime: h.DateTime,
      Duration: h.Duration,
      PauseDuration: h.PauseDuration,
      Distance: h.Distance,
      Ascent: h.Ascent,
      Descent: h.Descent,
      Device: { Info: { HW: h.Device?.Info?.HW, SW: h.Device?.Info?.SW }, Name: h.Device?.Name }
    },
    Samples: samples
  }
};

let donnees = Buffer.from(JSON.stringify(resultat));
if (sortie.endsWith('.gz')) donnees = zlib.gzipSync(donnees, { level: 9 });
fs.writeFileSync(sortie, donnees);
console.log(`${samples.length} échantillons écrits dans ${sortie} (${donnees.length} octets)`);
