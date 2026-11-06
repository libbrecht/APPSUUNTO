// =====================================================================
// Trois Chiffres — app SuuntoPlus (Suunto Vertical)
//
// Affiche en permanence la cible de FC du terrain sous tes pieds
// (montée, plat, descente), détecté par la vitesse verticale
// barométrique, et prévient si tu la dépasses trop longtemps.
//
// Spécification : « Spec — App SuuntoPlus « Trois Chiffres » », 5 nov. 2026.
//
// Règles imposées par le moteur SuuntoPlus (référence SuuntoPlus Editor) :
//  - JavaScript ES5 (Duktape) : ni let/const, ni fonctions fléchées, ni Date ;
//  - seules les fonctions de rappel du système sont déclarées
//    « function nom() » ; les fonctions maison s'écrivent
//    « var nom = function () {} » ;
//  - input.X et output.X s'écrivent toujours en accès statique : le
//    minifieur Suunto les remplace par des index de tableau. On ne passe
//    l'objet output qu'en argument direct d'une fonction maison.
// =====================================================================

// ---------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------

// États du terrain (sortie « etat », enregistrée à chaque seconde)
var PLAT = 0;
var MONTEE = 1;
var DESCENTE = 2;
var ARRET = 3;

// Couleurs de la FC (sortie « couleur », enregistrée à chaque seconde)
var GRIS = 0;
var VERT = 1;
var ORANGE = 2;
var ROUGE = 3;
var NEUTRE = 4;

// Vues de l'en-tête de l'écran principal (t.html, #hd).
// 0, 1 et 2 sont les terrains eux-mêmes.
var H_ARRET = 3;
var H_LIBRE = 4;
var H_FC_HAUTE = 5;
var H_PLAFOND = 6;
var H_BOIRE = 7;
var H_CAPTEUR = 8;
var H_PLAN_A = 9;
var H_PLAN_B = 10;

// Valeurs fixées par la spécification (non réglables)
var VZ_SAUT = 4000;            // m/h : au-delà, saut d'altitude rejeté
var VZ_LISSAGE = 15;           // s : moyenne glissante de la vitesse verticale
var ARRET_VITESSE = 1;         // km/h
var ARRET_VZ = 100;            // m/h
var ARRET_DUREE = 10;          // s
var REPRISE_VITESSE = 2;       // km/h
var REPRISE_DUREE = 5;         // s
var TRAINE = 60;               // s : cible la plus haute après un changement de terrain
var SUSPENSION_BASCULE = 60;   // s : alertes FC suspendues après une bascule de plan
var PLAFOND_DUREE = 15;        // s au-dessus du plafond avant de vibrer
var PLAFOND_REPETITION = 120;  // s : au plus une alerte plafond toutes les 2 min
var ROUGE_REPETITION = 180;    // s : rappel FC haute toutes les 3 min
var CAPTEUR_DUREE = 120;       // s sans FC avant l'alerte capteur
var FC_ECART_MAX = 20;         // bpm d'écart à la médiane des 5 dernières secondes
var ALLURE_LISSAGE = 30;       // s
var ALLURE_MIN = 0.3;          // m/s : plus lent, l'allure n'est pas affichée
var MESSAGE_DUREE = 6;         // s d'affichage d'une alerte en tête d'écran
var CONFIRMATION_DUREE = 10;   // s avant annulation automatique d'une bascule
var BILAN_DUREE = 30;          // s avant retour automatique à l'écran principal
var MAX_TRANCHES = 12;

// Indications sonores/vibrations disponibles : 'Button', 'Confirm', 'Info',
// 'Interval', 'StartTimer', 'StopTimer'. La montre vibre si les vibrations
// sont activées dans ses réglages. Une vibration « courte » ou « longue »
// est le motif propre à chaque indication ; « 2 courtes » = 2 indications
// à une seconde d'intervalle.
var VIB_COURTE = 'Info';
var VIB_LONGUE = 'Interval';

// Tampon unique (Float32Array) : vz | vitesse | FC | tri | tranches
var B_VZ = 0;
var B_SP = 15;
var B_FC = 45;
var B_TRI = 50;
var B_ZONES = 55;
var Z_TAILLE = 8;              // début, fin, décalage, p, m, d, a, libre
var B_TAILLE = 151;            // 55 + 12 tranches × 8

// ---------------------------------------------------------------------
// Réglages (lus dans data.json / l'app Suunto au chargement)
// ---------------------------------------------------------------------
var cibA;              // [plat, montée, descente] du plan A
var cibB;              // idem plan B
var capA;              // plafond absolu du plan A
var capB;              // plafond absolu du plan B
var planInitial;       // 0 = A, 1 = B
var nTranches;         // nombre de tranches de zones
var marge;             // bpm au-dessus de la cible avant le rouge
var seuilEntree;       // m/h
var seuilSortie;       // m/h
var persistance;       // s
var delaiAlerte;       // s en rouge avant de vibrer
var graceS;            // s sans alerte FC au départ
var boireS;            // s entre deux rappels boire (0 = désactivé)

// ---------------------------------------------------------------------
// État
// ---------------------------------------------------------------------
var tampon;            // Float32Array(B_TAILLE)
var demarre;           // l'exercice a démarré
var enPause;
var maintenant;        // s de séance (hors pauses)
var tic;               // compteur d'appels à evaluate (horloge de l'interface)

var etat;
var etatAvant;         // terrain à retrouver en sortant de l'ARRÊT
var etatVoulu;
var attente;           // s d'affilée où la condition de transition tient
var compteArret;
var compteReprise;
var vzPrec;            // m/h, dernière valeur acceptée
var vzLisse;           // m/h, moyenne glissante sur 15 s
var nVz;
var iVz;
var nSp;
var iSp;
var nFc;
var iFc;
var kmCourant;

var traineFin;         // fin de la traîne (en s de séance)
var traineMasque;      // terrains occupés pendant la traîne (bits)

var tgPlat;            // cibles du plan actif, zones appliquées
var tgMontee;
var tgDescente;
var tgPlafond;
var libre;

var plan;              // 0 = A, 1 = B
var nBascules;
var bascPlan;          // détail des 3 premières bascules
var bascKm;
var bascT;
var suspensionFin;

var fcAffichee;        // bpm affiché (0 = pas de FC)
var derniereFc;        // dernière FC acceptée (bpm)
var derniereFcT;       // instant de la dernière FC reçue
var capteurSignale;
var couleur;
var cibleActive;
var allure;            // m/s lissée sur 30 s (0 si trop lent)

var rougeDepuis;       // s d'affilée en rouge (alertes autorisées)
var plafondDepuis;     // s d'affilée au-dessus du plafond
var prochainRouge;
var prochainPlafond;
var prochainBoire;
var nAlertes;
var fileVib;           // indications en attente, une par seconde
var message;
var messageFin;

// Statistiques
var sommeFc;
var nFcTotal;
var sommeFcT;          // [plat, montée, descente]
var nFcT;
var tempsT;
var montee;            // m de D+ de la montée en cours
var monteeT;           // s de la montée en cours
var dPlus;             // m de D+ total en MONTÉE
var dPlusT;            // s en MONTÉE
var tempsRouge;

// Interface
var gabarit;           // 't' principal, 'b' bilan, 'ca'/'cb' confirmation
var gabaritDepuis;

// ---------------------------------------------------------------------
// Lecture des réglages
// ---------------------------------------------------------------------
var lireReglage = function (cle) {
  var v = null;
  if (typeof localStorage !== 'undefined' && localStorage) {
    v = localStorage.getItem(cle);
  }
  if (v === null || v === undefined) {
    return '';
  }
  return ('' + v).replace(/^\s+|\s+$/g, '');
};

var borner = function (v, mini, maxi) {
  if (v < mini) {
    return mini;
  }
  if (v > maxi) {
    return maxi;
  }
  return v;
};

var lireEntier = function (cle, defaut, mini, maxi) {
  var v = parseInt(lireReglage(cle), 10);
  if (isNaN(v)) {
    return defaut;
  }
  return borner(v, mini, maxi);
};

// « 160 165 150 » (espaces, virgules, points-virgules ou barres acceptés)
var lireNombres = function (texte) {
  var morceaux = texte.replace(/[,;\/]/g, ' ').split(' ');
  var r = [];
  var i;
  var v;
  for (i = 0; i < morceaux.length; i++) {
    if (morceaux[i] !== '') {
      v = parseFloat(morceaux[i]);
      if (!isNaN(v)) {
        r.push(v);
      }
    }
  }
  return r;
};

var lireCibles = function (cle, p, m, d) {
  var n = lireNombres(lireReglage(cle));
  if (n.length < 3) {
    return [p, m, d];
  }
  return [borner(Math.round(n[0]), 60, 230), borner(Math.round(n[1]), 60, 230),
    borner(Math.round(n[2]), 60, 230)];
};

// Zones par distance : « début-fin jeton jeton; début-fin jeton ... »
// Jetons : -4 / +2 (décalage des trois cibles), p155 m163 d148 (cible
// fixée), a165 (plafond fixé), libre. Les tranches s'appliquent dans
// l'ordre où elles sont écrites : un décalage s'ajoute, une valeur fixée
// remplace ; en cas de conflit, la dernière tranche l'emporte.
var lireZones = function (texte) {
  var tranches = texte.replace(/−/g, '-').split(';');
  var n = 0;
  var i;
  var j;
  var jetons;
  var bornes;
  var o;
  var jeton;
  var lettre;
  var v;
  for (i = 0; i < tranches.length && n < MAX_TRANCHES; i++) {
    jetons = tranches[i].replace(/^\s+|\s+$/g, '').split(/\s+/);
    bornes = /^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/.exec(jetons[0]);
    if (bornes && jetons.length > 1) {
      o = B_ZONES + n * Z_TAILLE;
      tampon[o] = parseFloat(bornes[1].replace(',', '.'));
      tampon[o + 1] = parseFloat(bornes[2].replace(',', '.'));
      tampon[o + 2] = 0;
      tampon[o + 3] = NaN;
      tampon[o + 4] = NaN;
      tampon[o + 5] = NaN;
      tampon[o + 6] = NaN;
      tampon[o + 7] = 0;
      for (j = 1; j < jetons.length; j++) {
        jeton = jetons[j].toLowerCase();
        if (/^[+\-]\d+$/.test(jeton)) {
          tampon[o + 2] += parseInt(jeton, 10);
        } else if (/^[pmda]\d+$/.test(jeton)) {
          lettre = jeton.charAt(0);
          v = borner(parseInt(jeton.substring(1), 10), 60, 230);
          if (lettre === 'p') {
            tampon[o + 3] = v;
          } else if (lettre === 'm') {
            tampon[o + 4] = v;
          } else if (lettre === 'd') {
            tampon[o + 5] = v;
          } else {
            tampon[o + 6] = v;
          }
        } else if (jeton === 'libre') {
          tampon[o + 7] = 1;
        }
      }
      n++;
    }
  }
  return n;
};

var lireReglages = function () {
  var s;
  var seuils;
  cibA = lireCibles('cibles_A', 160, 165, 150);
  cibB = lireCibles('cibles_B', 155, 160, 150);
  capA = lireEntier('plafond_A', 167, 80, 240);
  capB = lireEntier('plafond_B', 165, 80, 240);
  s = lireReglage('plan_initial').toUpperCase();
  planInitial = (s === '1' || s === 'B') ? 1 : 0;
  nTranches = lireZones(lireReglage('zones'));
  marge = lireEntier('marge', 3, 0, 30);
  seuils = lireNombres(lireReglage('seuils_vz'));
  seuilEntree = 300;
  seuilSortie = 150;
  if (seuils.length >= 2 && seuils[0] > 0 && seuils[1] >= 0 && seuils[1] < seuils[0]) {
    seuilEntree = seuils[0];
    seuilSortie = seuils[1];
  }
  persistance = lireEntier('persistance', 20, 1, 600);
  delaiAlerte = lireEntier('delai_alerte', 45, 1, 3600);
  graceS = lireEntier('grace', 10, 0, 240) * 60;
  boireS = lireEntier('boire', 15, 0, 600) * 60;
};

// ---------------------------------------------------------------------
// Cibles, zones et couleur
// ---------------------------------------------------------------------
var calculerCibles = function (km) {
  var base = plan === 0 ? cibA : cibB;
  var i;
  var o;
  tgPlat = base[0];
  tgMontee = base[1];
  tgDescente = base[2];
  tgPlafond = plan === 0 ? capA : capB;
  libre = 0;
  for (i = 0; i < nTranches; i++) {
    o = B_ZONES + i * Z_TAILLE;
    if (km >= tampon[o] && km <= tampon[o + 1]) {
      tgPlat += tampon[o + 2];
      tgMontee += tampon[o + 2];
      tgDescente += tampon[o + 2];
      if (!isNaN(tampon[o + 3])) {
        tgPlat = tampon[o + 3];
      }
      if (!isNaN(tampon[o + 4])) {
        tgMontee = tampon[o + 4];
      }
      if (!isNaN(tampon[o + 5])) {
        tgDescente = tampon[o + 5];
      }
      if (!isNaN(tampon[o + 6])) {
        tgPlafond = tampon[o + 6];
      }
      if (tampon[o + 7] > 0) {
        libre = 1;
      }
    }
  }
};

var cibleDe = function (e) {
  if (e === MONTEE) {
    return tgMontee;
  }
  if (e === DESCENTE) {
    return tgDescente;
  }
  return tgPlat;
};

// Cible servant à juger la couleur : pendant la traîne de 60 s qui suit
// un changement de terrain, la plus haute des cibles en jeu.
var cibleEffective = function () {
  var e = etat === ARRET ? etatAvant : etat;
  var c = cibleDe(e);
  var t;
  var s;
  if (etat !== ARRET && maintenant < traineFin) {
    for (s = 0; s < 3; s++) {
      if ((traineMasque >> s) & 1) {
        t = cibleDe(s);
        if (t > c) {
          c = t;
        }
      }
    }
  }
  return c;
};

// Couleur de la FC (bpm entiers) pour le terrain e et la cible c.
var couleurDe = function (fc, e, c) {
  if (fc > c + marge || fc > tgPlafond) {
    return ROUGE;
  }
  if (e === DESCENTE) {
    return fc >= c + 1 ? ORANGE : VERT;
  }
  if (fc >= c + 2) {
    return ORANGE;
  }
  if (fc >= c - 6) {
    return VERT;
  }
  return GRIS;
};

// ---------------------------------------------------------------------
// Détection du terrain
// ---------------------------------------------------------------------
var etatSuivant = function (e, v) {
  if (v >= seuilEntree) {
    return MONTEE;
  }
  if (v <= -seuilEntree) {
    return DESCENTE;
  }
  if (e === MONTEE && v > seuilSortie) {
    return MONTEE;
  }
  if (e === DESCENTE && v < -seuilSortie) {
    return DESCENTE;
  }
  return PLAT;
};

var changerEtat = function (e) {
  var ancien = etat;
  if (e === ancien) {
    return;
  }
  if (e === ARRET) {
    etatAvant = ancien;
  } else if (ancien !== ARRET) {
    // Vrai changement de terrain : traîne de 60 s
    traineMasque = (maintenant < traineFin ? traineMasque : 0) | (1 << ancien);
    traineFin = maintenant + TRAINE;
    if (e === MONTEE) {
      montee = 0;
      monteeT = 0;
    }
  }
  etat = e;
  attente = 0;
  etatVoulu = -1;
  compteArret = 0;
  compteReprise = 0;
};

var moyenneVz = function (v) {
  var s = 0;
  var i;
  tampon[B_VZ + iVz] = v;
  iVz = (iVz + 1) % VZ_LISSAGE;
  if (nVz < VZ_LISSAGE) {
    nVz++;
  }
  for (i = 0; i < nVz; i++) {
    s += tampon[B_VZ + i];
  }
  return s / nVz;
};

// v : vitesse verticale (m/h, NaN si absente) ; vit : vitesse (km/h, NaN si absente)
var detecter = function (v, vit) {
  var voulu;
  if (isNaN(v) || Math.abs(v) > VZ_SAUT) {
    v = vzPrec;
  }
  vzPrec = v;
  vzLisse = moyenneVz(v);

  // 1. Arrêt, évalué en premier
  if (etat !== ARRET) {
    compteArret = (!isNaN(vit) && vit <= ARRET_VITESSE && Math.abs(vzLisse) <= ARRET_VZ) ?
      compteArret + 1 : 0;
    if (compteArret >= ARRET_DUREE) {
      changerEtat(ARRET);
      return;
    }
  } else {
    if (!isNaN(vit)) {
      compteReprise = vit >= REPRISE_VITESSE ? compteReprise + 1 : 0;
    }
    if (compteReprise >= REPRISE_DUREE) {
      changerEtat(etatAvant);
    }
    return;
  }

  // 2. Terrain, avec hystérésis et persistance
  voulu = etatSuivant(etat, vzLisse);
  if (voulu === etat) {
    attente = 0;
  } else {
    attente = voulu === etatVoulu ? attente + 1 : 1;
    etatVoulu = voulu;
  }
  if (attente >= persistance) {
    changerEtat(voulu);
  }
};

// ---------------------------------------------------------------------
// FC : rejet des valeurs aberrantes
// ---------------------------------------------------------------------
var medianeFc = function () {
  var i;
  var j;
  var x;
  for (i = 0; i < nFc; i++) {
    x = tampon[B_FC + i];
    j = i - 1;
    while (j >= 0 && tampon[B_TRI + j] > x) {
      tampon[B_TRI + j + 1] = tampon[B_TRI + j];
      j--;
    }
    tampon[B_TRI + j + 1] = x;
  }
  if (nFc % 2 === 1) {
    return tampon[B_TRI + (nFc - 1) / 2];
  }
  return (tampon[B_TRI + nFc / 2 - 1] + tampon[B_TRI + nFc / 2]) / 2;
};

// Renvoie la FC en bpm, -1 si la valeur est rejetée, 0 si pas de FC.
var lireFc = function (hz) {
  var b;
  var rejet = false;
  if (typeof hz !== 'number' || !(hz >= 0.5 && hz <= 4.2)) {
    return 0;
  }
  b = hz * 60;
  if (nFc >= 3 && Math.abs(b - medianeFc()) > FC_ECART_MAX) {
    rejet = true;
  }
  tampon[B_FC + iFc] = b;
  iFc = (iFc + 1) % 5;
  if (nFc < 5) {
    nFc++;
  }
  return rejet ? -1 : b;
};

var lisserAllure = function (ms) {
  var s = 0;
  var i;
  if (!isNaN(ms) && ms >= 0) {
    tampon[B_SP + iSp] = ms;
    iSp = (iSp + 1) % ALLURE_LISSAGE;
    if (nSp < ALLURE_LISSAGE) {
      nSp++;
    }
  }
  if (nSp === 0) {
    return 0;
  }
  for (i = 0; i < nSp; i++) {
    s += tampon[B_SP + i];
  }
  s = s / nSp;
  return s >= ALLURE_MIN ? s : 0;
};

// ---------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------
var vibrer = function (indication, fois) {
  var i;
  for (i = 0; i < fois && fileVib.length < 8; i++) {
    fileVib.push(indication);
  }
};

var afficherMessage = function (m) {
  message = m;
  messageFin = tic + MESSAGE_DUREE;
};

var reinitialiserAlertesFc = function () {
  rougeDepuis = 0;
  plafondDepuis = 0;
  prochainRouge = 0;
};

var gererAlertes = function (fcOk, fc) {
  var actives = fcOk && etat !== ARRET && !libre && maintenant >= graceS &&
    maintenant >= suspensionFin;

  if (actives) {
    rougeDepuis = couleur === ROUGE ? rougeDepuis + 1 : 0;
    plafondDepuis = fc > tgPlafond ? plafondDepuis + 1 : 0;
    if (rougeDepuis === 0) {
      prochainRouge = 0;
    }
    if (plafondDepuis >= PLAFOND_DUREE && maintenant >= prochainPlafond) {
      vibrer(VIB_LONGUE, 3);
      afficherMessage(H_PLAFOND);
      nAlertes++;
      prochainPlafond = maintenant + PLAFOND_REPETITION;
      // le rappel FC haute repart de zéro : pas de double alerte
      prochainRouge = maintenant + ROUGE_REPETITION;
    } else if (rougeDepuis >= delaiAlerte && plafondDepuis < PLAFOND_DUREE &&
        maintenant >= prochainRouge) {
      vibrer(VIB_COURTE, 2);
      afficherMessage(H_FC_HAUTE);
      nAlertes++;
      prochainRouge = maintenant + ROUGE_REPETITION;
    }
  } else {
    reinitialiserAlertesFc();
  }

  // Capteur FC : une alerte par coupure
  if (fcOk) {
    capteurSignale = false;
  } else if (!capteurSignale && maintenant - derniereFcT >= CAPTEUR_DUREE) {
    capteurSignale = true;
    vibrer(VIB_LONGUE, 1);
    afficherMessage(H_CAPTEUR);
  }

  // Boire : indépendant du terrain, actif même en ARRÊT ou zone libre
  if (boireS > 0 && maintenant >= prochainBoire) {
    vibrer(VIB_LONGUE, 1);
    afficherMessage(H_BOIRE);
    while (prochainBoire <= maintenant) {
      prochainBoire += boireS;
    }
  }
};

// ---------------------------------------------------------------------
// Une seconde de séance
// ---------------------------------------------------------------------
var pas = function (hz, vzMs, vitMs, distM) {
  var vz = (typeof vzMs === 'number') ? vzMs * 3600 : NaN;
  var vitMsOk = (typeof vitMs === 'number') ? vitMs : NaN;
  var fc;
  var fcOk;
  var monteeS;

  if (typeof distM === 'number' && !isNaN(distM)) {
    kmCourant = distM / 1000;
  }

  detecter(vz, vitMsOk * 3.6);
  allure = lisserAllure(vitMsOk);
  calculerCibles(kmCourant);

  fc = lireFc(hz);
  if (fc > 0) {
    derniereFc = Math.round(fc);
    derniereFcT = maintenant;
  } else if (fc < 0) {
    derniereFcT = maintenant;
  }
  fcOk = fc !== 0 && derniereFc > 0;
  fcAffichee = fcOk ? derniereFc : 0;

  cibleActive = cibleEffective();
  if (!fcOk || etat === ARRET || libre) {
    couleur = NEUTRE;
  } else {
    couleur = couleurDe(fcAffichee, etat, cibleActive);
  }

  // Statistiques (les valeurs rejetées et les trous sont ignorés)
  if (fc > 0) {
    sommeFc += derniereFc;
    nFcTotal++;
  }
  if (etat !== ARRET) {
    tempsT[etat] += 1;
    if (fc > 0) {
      sommeFcT[etat] += derniereFc;
      nFcT[etat] += 1;
    }
    if (etat === MONTEE) {
      monteeS = vzPrec > 0 ? vzPrec / 3600 : 0;
      montee += monteeS;
      monteeT += 1;
      dPlus += monteeS;
      dPlusT += 1;
    }
  }
  if (couleur === ROUGE) {
    tempsRouge += 1;
  }

  gererAlertes(fcOk, fcAffichee);
};

// ---------------------------------------------------------------------
// Initialisations
// ---------------------------------------------------------------------
var reinitialiserDetection = function () {
  etat = PLAT;
  etatAvant = PLAT;
  etatVoulu = -1;
  attente = 0;
  compteArret = 0;
  compteReprise = 0;
  vzPrec = 0;
  vzLisse = 0;
  nVz = 0;
  iVz = 0;
  nSp = 0;
  iSp = 0;
  nFc = 0;
  iFc = 0;
  traineFin = 0;
  traineMasque = 0;
  montee = 0;
  monteeT = 0;
  allure = 0;
  reinitialiserAlertesFc();
};

var reinitialiserSeance = function () {
  maintenant = 0;
  kmCourant = 0;
  reinitialiserDetection();
  plan = planInitial;
  nBascules = 0;
  bascPlan = [];
  bascKm = [];
  bascT = [];
  suspensionFin = 0;
  fcAffichee = 0;
  derniereFc = 0;
  derniereFcT = 0;
  capteurSignale = false;
  couleur = NEUTRE;
  prochainPlafond = 0;
  prochainBoire = boireS;
  nAlertes = 0;
  fileVib = [];
  message = -1;
  messageFin = 0;
  sommeFc = 0;
  nFcTotal = 0;
  sommeFcT = [0, 0, 0];
  nFcT = [0, 0, 0];
  tempsT = [0, 0, 0];
  dPlus = 0;
  dPlusT = 0;
  tempsRouge = 0;
  calculerCibles(0);
  cibleActive = tgPlat;
};

// ---------------------------------------------------------------------
// Interface : écrans, bascule de plan, sorties
// ---------------------------------------------------------------------
var ouvrir = function (nom) {
  gabarit = nom;
  gabaritDepuis = tic;
  unload('_cm');
};

var basculerPlan = function () {
  plan = 1 - plan;
  nBascules++;
  if (bascPlan.length < 3) {
    bascPlan.push(plan);
    bascKm.push(kmCourant);
    bascT.push(maintenant);
  }
  suspensionFin = maintenant + SUSPENSION_BASCULE;
  reinitialiserAlertesFc();
  calculerCibles(kmCourant);
  cibleActive = cibleEffective();
  afficherMessage(plan === 0 ? H_PLAN_A : H_PLAN_B);
};

var moyenneT = function (e) {
  return nFcT[e] > 0 ? Math.round(sommeFcT[e] / nFcT[e]) : 0;
};

var vamMoyenne = function () {
  return dPlusT > 0 ? Math.round(dPlus / dPlusT * 3600) : 0;
};

// Valeurs 50 à 249 empaquetées sur 3 « chiffres » en base 200 : l'entier
// reste exact une fois converti en flottant 32 bits par la montre.
var paquetCibles = function (p) {
  var c = p === 0 ? cibA : cibB;
  return ((borner(c[0], 50, 249) - 50) * 200 + (borner(c[1], 50, 249) - 50)) * 200 +
    (borner(c[2], 50, 249) - 50);
};

// Tout l'état visuel de l'écran principal en un seul entier. Le bit de
// parité change à chaque seconde pour que l'écran se resynchronise.
var paquetUi = function () {
  var h;
  var b;
  if (message >= 0 && tic < messageFin) {
    h = message;
  } else if (etat === ARRET) {
    h = H_ARRET;
  } else if (libre) {
    h = H_LIBRE;
  } else {
    h = etat;
  }
  if (etat === MONTEE) {
    b = 0;
  } else if (etat !== ARRET && allure > 0) {
    b = 1;
  } else {
    b = 2;
  }
  return (tic % 2) + 2 * (h + 11 * (couleur + 5 * (b + 3 * plan)));
};

var ecrireSorties = function (o) {
  o.etat = etat;
  o.cible = cibleActive;
  o.couleur = couleur;
  o.plan = plan + 1;
  o.fc = fcAffichee;
  o.fcm = nFcTotal > 0 ? Math.round(sommeFc / nFcTotal) : 0;
  o.vam = (etat === MONTEE && monteeT > 0) ? Math.round(montee / monteeT * 3600) : 0;
  o.allure = allure;
  o.ui = paquetUi();
  o.fp = moyenneT(PLAT);
  o.fm = moyenneT(MONTEE);
  o.fd = moyenneT(DESCENTE);
  o.tp = tempsT[PLAT];
  o.tm = tempsT[MONTEE];
  o.td = tempsT[DESCENTE];
  o.vm = vamMoyenne();
  o.tr = tempsRouge;
  o.np = paquetCibles(1 - plan);
  o.npc = plan === 0 ? capB : capA;
};

var heuresMinutes = function (s) {
  var m = Math.round(s / 60);
  var h = Math.floor(m / 60);
  m = m % 60;
  return h + 'h' + (m < 10 ? '0' : '') + m;
};

var texteBascules = function () {
  var t = '';
  var i;
  for (i = 0; i < bascPlan.length; i++) {
    t += (i > 0 ? ' | ' : '') + (bascPlan[i] === 0 ? 'A ' : 'B ') +
      ('' + Math.round(bascKm[i] * 10) / 10).replace('.', ',') + 'km ' +
      heuresMinutes(bascT[i]);
  }
  if (nBascules > bascPlan.length) {
    t += ' ...';
  }
  return t;
};

// ---------------------------------------------------------------------
// Fonctions de rappel SuuntoPlus
// ---------------------------------------------------------------------
function onLoad(input, output) {
  tampon = new Float32Array(B_TAILLE);
  tic = 0;
  demarre = false;
  enPause = false;
  gabarit = 't';
  gabaritDepuis = 0;
  lireReglages();
  reinitialiserSeance();
  ecrireSorties(output);
}

function onExerciseStart(input, output) {
  reinitialiserSeance();
  demarre = true;
  enPause = false;
  ecrireSorties(output);
}

function onExercisePause(input, output) {
  enPause = true;
}

// À la reprise : état remis à PLAT, compteurs et traîne réinitialisés.
function onExerciseContinue(input, output) {
  enPause = false;
  reinitialiserDetection();
  calculerCibles(kmCourant);
  cibleActive = cibleEffective();
  ecrireSorties(output);
}

function evaluate(input, output) {
  var d;
  tic++;

  // Retour automatique à l'écran principal
  if ((gabarit === 'ca' || gabarit === 'cb') && tic - gabaritDepuis >= CONFIRMATION_DUREE) {
    ouvrir('t');
  } else if (gabarit === 'b' && tic - gabaritDepuis >= BILAN_DUREE) {
    ouvrir('t');
  }

  if (demarre && !enPause) {
    d = input.dur;
    maintenant = (typeof d === 'number' && !isNaN(d)) ? d : maintenant + 1;
    pas(input.hr, input.vz, input.spd, input.dist);
    if (fileVib.length > 0) {
      playIndication(fileVib.shift());
    }
  }
  ecrireSorties(output);
}

// Événements envoyés par les boutons des écrans :
// 1 appui long bas (principal) → confirmation de bascule
// 2 appui court bas (confirmation) → bascule
// 3 autre bouton (confirmation) → annulation
// 4 appui court bas (principal) → bilan
// 5 bouton ou toucher (bilan) → écran principal
function onEvent(input, output, eventId) {
  if (eventId == 1) {
    if (gabarit === 't') {
      ouvrir(plan === 0 ? 'cb' : 'ca');
    }
  } else if (eventId == 2) {
    if (gabarit === 'ca' || gabarit === 'cb') {
      basculerPlan();
    }
    ouvrir('t');
  } else if (eventId == 3 || eventId == 5) {
    ouvrir('t');
  } else if (eventId == 4) {
    if (gabarit === 't') {
      ouvrir('b');
    }
  }
  ecrireSorties(output);
}

function getUserInterface(input, output) {
  return {
    template: gabarit
  };
}

function getSummaryOutputs(input, output) {
  if (!demarre) {
    return [];
  }
  return [
    { id: 'p', name: 'FC plat', format: 'Count_Threedigits', value: moyenneT(PLAT),
      postfix: 'bpm · ' + heuresMinutes(tempsT[PLAT]) },
    { id: 'm', name: 'FC montée', format: 'Count_Threedigits', value: moyenneT(MONTEE),
      postfix: 'bpm · ' + heuresMinutes(tempsT[MONTEE]) },
    { id: 'd', name: 'FC descente', format: 'Count_Threedigits', value: moyenneT(DESCENTE),
      postfix: 'bpm · ' + heuresMinutes(tempsT[DESCENTE]) },
    { id: 'v', name: 'VAM moyenne', format: 'Count_Fourdigits', value: vamMoyenne(),
      postfix: 'm/h' },
    { id: 'r', name: 'Temps au-dessus', format: 'Duration_Fourdigits', value: tempsRouge },
    { id: 'a', name: 'Alertes FC', format: 'Count_Threedigits', value: nAlertes },
    { id: 'b', name: 'Bascules', format: 'Count_Twodigits', value: nBascules,
      postfix: texteBascules() }
  ];
}
