// Reproduction de la transformation que fait le minifieur de SuuntoPlus
// Editor (suuntoplus-tools, lib/javascript/minifier.js) avant d'envoyer
// main.js sur la montre :
//  - seules les déclarations « var » de premier niveau et les fonctions de
//    rappel connues sont conservées (le reste disparaît) ;
//  - dans chaque fonction de rappel, input.X et output.X deviennent _[i]
//    (un seul tableau : entrées puis sorties, dans l'ordre du manifeste) ;
//  - quand input ou output est passé tel quel à une fonction maison
//    « var f = function (...) », le corps de f est transformé de même ;
//  - le 3e paramètre de onEvent devient _d ;
//  - toutes les fonctions de rappel sont fusionnées en
//    « return function (_e, _, _d) { if (_e === id) { ... } ... } ».
// L'étape terser (renommage des variables) ne change pas le comportement et
// n'est pas reproduite.
'use strict';

const acorn = require('acorn');
const { generate } = require('astring');

const ID_EVENEMENTS = {
  evaluate: 1,
  onLoad: 2,
  onLap: 4,
  onAutoLap: 8,
  onInterval: 16,
  onPoolLength: 32,
  onExerciseStart: 128,
  onExercisePause: 256,
  onExerciseContinue: 512,
  onExerciseEnd: 1024,
  onActivityChange: 2048,
  getUserInterface: 4096,
  getSummaryOutputs: 8192,
  onEvent: 16384,
  onAccelerometer: 32768
};

const NOM_ES = '_';
const NOM_EVENEMENT = '_e';
const NOM_ARGUMENT = '_d';

// Parcours générique en profondeur avec le parent
function parcourir(noeud, visite, parent = null) {
  if (!noeud || typeof noeud.type !== 'string') return;
  visite(noeud, parent);
  for (const cle of Object.keys(noeud)) {
    if (cle === 'type' || cle === 'start' || cle === 'end' || cle === 'loc') continue;
    const v = noeud[cle];
    if (Array.isArray(v)) {
      for (const enfant of v) parcourir(enfant, visite, noeud);
    } else if (v && typeof v.type === 'string') {
      parcourir(v, visite, noeud);
    }
  }
}

function minifier(code, manifeste) {
  const entrees = (manifeste.in || []).map((e) => e.name);
  const sorties = (manifeste.out || []).map((s) => s.name);
  const ast = acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' });

  const varsPremierNiveau = [];
  const aides = new Map();
  const fonctions = new Map();

  // Collecte (même règles que le minifieur officiel)
  (function collecter(noeud, auPremierNiveau) {
    if (!noeud || typeof noeud.type !== 'string') return;
    if (noeud.type === 'VariableDeclaration') {
      if (auPremierNiveau) varsPremierNiveau.push(noeud);
      for (const d of noeud.declarations) {
        if (d.init && d.init.type === 'FunctionExpression' && d.id.type === 'Identifier') {
          aides.set(d.id.name, d.init);
        }
      }
    }
    if (noeud.type === 'FunctionDeclaration' && noeud.id) fonctions.set(noeud.id.name, noeud);
    const estFonction = noeud.type === 'FunctionDeclaration' || noeud.type === 'FunctionExpression';
    for (const cle of Object.keys(noeud)) {
      if (cle === 'type' || cle === 'start' || cle === 'end') continue;
      const v = noeud[cle];
      const niveau = noeud.type === 'Program' ? true : (estFonction ? false : auPremierNiveau);
      if (Array.isArray(v)) v.forEach((e) => collecter(e, niveau));
      else if (v && typeof v.type === 'string') collecter(v, niveau);
    }
  })(ast, true);

  const index = (nom, liste, decalage, genre) => {
    const i = liste.indexOf(nom);
    if (i < 0) throw new Error(`Propriété ${genre} inconnue '${nom}'`);
    return i + decalage;
  };

  const membre = (n, nomE, nomS, renommer) => {
    if (n.object.type !== 'Identifier') return;
    let prop;
    if (n.property.type === 'Identifier') prop = n.property.name;
    else if (n.property.type === 'Literal' && typeof n.property.value === 'string') prop = n.property.value;
    else return;
    let i;
    if (n.object.name === nomE) i = index(prop, entrees, 0, "d'entrée");
    else if (n.object.name === nomS) i = index(prop, sorties, entrees.length, 'de sortie');
    else return;
    n.object = { type: 'Identifier', name: renommer ? NOM_ES : n.object.name };
    n.property = { type: 'Literal', value: i, raw: String(i) };
    n.computed = true;
  };

  const transformer = (corps, params, iE, iS, iEv, renommer) => {
    const nom = (i) => (i !== undefined && params[i] && params[i].type === 'Identifier' ? params[i].name : undefined);
    const nomE = nom(iE);
    const nomS = nom(iS);
    const nomEv = nom(iEv);
    parcourir(corps, (n, parent) => {
      if (n.type === 'MemberExpression') {
        membre(n, nomE, nomS, renommer);
      } else if (n.type === 'CallExpression') {
        n.arguments.forEach((arg, i) => {
          if (arg.type !== 'Identifier' || n.callee.type !== 'Identifier') return;
          const aide = aides.get(n.callee.name);
          if (!aide) return;
          if (arg.name === nomE) {
            if (renommer) arg.name = NOM_ES;
            transformer(aide.body, aide.params, i, undefined, undefined, false);
          } else if (arg.name === nomS) {
            if (renommer) arg.name = NOM_ES;
            transformer(aide.body, aide.params, undefined, i, undefined, false);
          }
        });
      } else if (n.type === 'Identifier') {
        if ((!parent || parent.type !== 'MemberExpression') && nomEv && n.name === nomEv) {
          n.name = NOM_ARGUMENT;
        }
      }
    });
  };

  const blocs = [];
  for (const [nom, f] of fonctions) {
    const id = ID_EVENEMENTS[nom];
    if (id === undefined) continue;
    transformer(f.body, f.params, 0, 1, nom === 'onEvent' ? 2 : undefined, true);
    blocs.push({
      type: 'IfStatement',
      test: {
        type: 'BinaryExpression',
        operator: '===',
        left: { type: 'Identifier', name: NOM_EVENEMENT },
        right: { type: 'Literal', value: id, raw: String(id) }
      },
      consequent: f.body,
      alternate: null
    });
  }

  let resultat = '';
  for (const v of varsPremierNiveau) resultat += generate(v);
  resultat += generate({
    type: 'Program',
    sourceType: 'script',
    body: [{
      type: 'ReturnStatement',
      argument: {
        type: 'FunctionExpression',
        id: null,
        params: [NOM_EVENEMENT, NOM_ES, NOM_ARGUMENT].map((name) => ({ type: 'Identifier', name })),
        body: { type: 'BlockStatement', body: blocs }
      }
    }]
  });
  return resultat;
}

module.exports = { minifier, ID_EVENEMENTS };
