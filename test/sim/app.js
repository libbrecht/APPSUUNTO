// Émulateur minimal du runtime SuuntoPlus pour exécuter main.js sous Node.
//
// Deux modes :
//  - 'source'  : main.js tel quel ; input/output sont des objets nommés
//                (comme dans le simulateur de SuuntoPlus Editor) ;
//  - 'minifie' : main.js transformé comme le fait le minifieur Suunto
//                (voir minifieur.js) et appelé comme sur la montre :
//                fn(idEvenement, tableauEntreesSorties, argument).
//
// Les fonctions natives (playIndication, unload, localStorage, $...) sont
// remplacées par des espions qui enregistrent les appels.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { minifier, ID_EVENEMENTS } = require('./minifieur');

const DOSSIER_APP = path.join(__dirname, '..', '..', 'TroisChiffres');

const lireJson = (fichier) => JSON.parse(fs.readFileSync(fichier, 'utf8'));
const manifeste = (dossier = DOSSIER_APP) => lireJson(path.join(dossier, 'manifest.json'));
const reglagesParDefaut = (dossier = DOSSIER_APP) => lireJson(path.join(dossier, 'data.json'));

// Même comportement que AppSettings du simulateur : getItem ne rend que des chaînes.
class StockageLocal {
  constructor(donnees) {
    this.donnees = new Map(Object.entries(donnees));
  }
  getItem(cle) {
    const v = this.donnees.get(cle);
    return typeof v === 'string' ? v : null;
  }
  setItem(cle, valeur) {
    this.donnees.set(cle, '' + valeur);
  }
  getObject(cle) {
    return this.donnees.get(cle);
  }
  setObject(cle, valeur) {
    this.donnees.set(cle, valeur);
  }
  key(i) {
    return Array.from(this.donnees.keys())[i];
  }
}

class App {
  constructor({ reglages = {}, mode = 'source', dossier = DOSSIER_APP } = {}) {
    this.manifeste = manifeste(dossier);
    this.mode = mode;
    this.nomsEntrees = (this.manifeste.in || []).map((e) => e.name);
    this.nomsSorties = (this.manifeste.out || []).map((s) => s.name);
    this.tic = 0;
    this.indications = [];
    this.unloads = 0;
    this.gabarit = null;
    this.evenementsSysteme = [];

    const app = this;
    const contexte = {
      localStorage: new StockageLocal({ ...reglagesParDefaut(dossier), ...reglages }),
      playIndication(nom, bouton, prio, stop) {
        app.indications.push({ tic: app.tic, nom, prio, stop });
      },
      unload(vue) {
        if (vue !== '_cm') throw new Error(`unload('${vue}') : seule la vue '_cm' existe`);
        app.unloads++;
        app.gabarit = app.getUserInterface().template;
      },
      setText() {},
      setStyle() {},
      getStyle() { return ''; },
      systemEvent(texte) { app.evenementsSysteme.push(texte); },
      trace() {},
      $: { put() {}, get() {}, subscribe() { return 0; }, unsubscribe() {} }
    };
    vm.createContext(contexte);
    this.contexte = contexte;

    const code = fs.readFileSync(path.join(dossier, 'main.js'), 'utf8');
    if (mode === 'source') {
      vm.runInContext(code, contexte, { filename: 'main.js' });
      const sorties = new Set(this.nomsSorties);
      const entrees = new Set(this.nomsEntrees);
      this.entree = {};
      this.entreeProxy = new Proxy(this.entree, {
        get(cible, cle) {
          if (typeof cle === 'string' && !entrees.has(cle)) {
            throw new Error(`main.js lit une entrée absente du manifeste : ${cle}`);
          }
          return cible[cle];
        }
      });
      this.sortie = {};
      this.sortieProxy = new Proxy(this.sortie, {
        set(cible, cle, valeur) {
          if (!sorties.has(cle)) throw new Error(`main.js écrit une sortie absente du manifeste : ${cle}`);
          cible[cle] = valeur;
          return true;
        }
      });
    } else if (mode === 'minifie') {
      const transforme = minifier(code, this.manifeste);
      this.codeMinifie = transforme;
      this.fonction = vm.runInContext(`(function () {\n${transforme}\n})()`, contexte, {
        filename: 'main.min.js'
      });
      this.es = new Array(this.nomsEntrees.length + this.nomsSorties.length);
    } else {
      throw new Error(`mode inconnu : ${mode}`);
    }
  }

  // Appelle une fonction de rappel ; renvoie sa valeur de retour.
  appeler(nom, argument) {
    if (this.mode === 'source') {
      const f = this.contexte[nom];
      if (typeof f !== 'function') return undefined;
      return nom === 'onEvent' ?
        f(this.entreeProxy, this.sortieProxy, argument) :
        f(this.entreeProxy, this.sortieProxy);
    }
    const id = ID_EVENEMENTS[nom];
    return this.fonction(id, this.es, argument);
  }

  definirEntrees(valeurs) {
    if (this.mode === 'source') {
      for (const n of this.nomsEntrees) this.entree[n] = valeurs[n];
    } else {
      this.nomsEntrees.forEach((n, i) => { this.es[i] = valeurs[n]; });
    }
  }

  // Copie des sorties sous forme d'objet nommé
  sorties() {
    if (this.mode === 'source') return { ...this.sortie };
    const o = {};
    const base = this.nomsEntrees.length;
    this.nomsSorties.forEach((n, i) => { o[n] = this.es[base + i]; });
    return o;
  }

  // Lit une variable globale de main.js (mode source uniquement)
  variable(nom) {
    if (this.mode !== 'source') throw new Error('variable() : mode source uniquement');
    return this.contexte[nom];
  }

  onLoad() {
    this.appeler('onLoad');
    this.gabarit = this.getUserInterface().template;
  }
  onExerciseStart() { this.appeler('onExerciseStart'); }
  onExercisePause() { this.appeler('onExercisePause'); }
  onExerciseContinue() { this.appeler('onExerciseContinue'); }
  onExerciseEnd() { this.appeler('onExerciseEnd'); }
  getUserInterface() { return this.appeler('getUserInterface'); }
  getSummaryOutputs() { return this.appeler('getSummaryOutputs'); }
  onEvent(id) {
    this.appeler('onEvent', id);
    return this.sorties();
  }

  evaluate(entrees = {}) {
    this.tic++;
    this.definirEntrees(entrees);
    const debut = process.hrtime.bigint();
    this.appeler('evaluate');
    const dureeMs = Number(process.hrtime.bigint() - debut) / 1e6;
    if (dureeMs > 1000) throw new Error(`evaluate trop lent : ${dureeMs} ms`);
    return this.sorties();
  }
}

module.exports = { App, StockageLocal, DOSSIER_APP, manifeste, reglagesParDefaut };
