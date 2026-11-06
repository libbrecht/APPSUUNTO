// Contrôles statiques : les règles que l'outil de build de SuuntoPlus
// Editor applique avant d'accepter une app (manifeste, main.js, écrans).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { ESLint } = require('eslint');
const { DOSSIER_APP } = require('./sim/app');
const { minifier } = require('./sim/minifieur');

const lire = (f) => fs.readFileSync(path.join(DOSSIER_APP, f), 'utf8');
const manifeste = JSON.parse(lire('manifest.json'));
const donnees = JSON.parse(lire('data.json'));
const code = lire('main.js');
const octets = (s) => Buffer.byteLength(s, 'utf8');

// Fonctions de rappel des « sports apps » et fonctions natives (référence
// SuuntoPlus Editor 1.45, suuntoplus-tools/lib/javascript/function.js)
const RAPPELS = ['evaluate', 'getUserInterface', 'getLapInfo', 'getSummaryOutputs', 'onAutoLap',
  'onAccelerometer', 'onActivityChange', 'onEvent', 'onExerciseContinue', 'onExerciseEnd',
  'onExercisePause', 'onExerciseStart', 'onInterval', 'onLap', 'onLoad', 'onPoolLength'];
const NATIVES = ['evalFile', 'unload', 'playIndication', 'setText', 'systemEvent', 'translate',
  'formatValue', 'open', 'close', 'trace', 'previous', 'next', 'first', 'last', 'select',
  'navigate', 'control', 'setStyle', 'getStyle', 'gaugeControl'];
const GLOBALES = ['appConn', 'enabledZappId', '$', 'localStorage', 'zPopupShown',
  'Int8Array', 'Uint8Array', 'Float32Array', 'DataView'];
const INDICATIONS = ['Button', 'Confirm', 'Info', 'Interval', 'StartTimer', 'StopTimer'];
const FORMATS = ['Count_Twodigits', 'Count_Threedigits', 'Count_Fourdigits', 'Duration_Fourdigits',
  'Pace_Fourdigits', 'HeartRate_Fourdigits'];

test('manifeste : champs obligatoires et limites', () => {
  for (const c of ['name', 'version', 'author', 'description', 'type', 'usage', 'modificationTime', 'template']) {
    assert.ok(c in manifeste, c);
  }
  assert.ok(octets(manifeste.name) <= 60);
  assert.ok(octets(manifeste.description) <= 100, `${octets(manifeste.description)} octets`);
  assert.ok(manifeste.version.length <= 4);
  assert.equal(manifeste.type, 'feature');
  assert.equal(manifeste.usage, 'workout');
  assert.ok(Number.isInteger(manifeste.modificationTime));
  assert.ok(manifeste.in.length <= 10, 'au plus 10 entrées');
  assert.ok(manifeste.out.length <= 20, 'au plus 20 sorties');
  assert.ok(manifeste.out.filter((o) => o.log).length <= 5, 'au plus 5 sorties enregistrées');
  const permis = new Set(['name', 'version', 'author', 'description', 'type', 'usage', 'modificationTime',
    'in', 'out', 'template', 'image', 'variables', 'settings', 'languages', 'activities', 'authorId', 'externalId', 'localDate']);
  for (const c of Object.keys(manifeste)) assert.ok(permis.has(c), `champ inconnu ${c}`);
});

test('manifeste : les cinq entrées de la spec, en ressources Activity/Move', () => {
  const sources = Object.fromEntries(manifeste.in.map((e) => [e.name, e.source]));
  assert.deepEqual(sources, {
    hr: 'Activity/Move/-1/HeartRate/Current',
    vz: 'Activity/Move/-1/VerticalSpeed/Current',
    spd: 'Activity/Move/-1/Speed/Current',
    dist: 'Activity/Move/-1/Distance/Current',
    dur: 'Activity/Move/-1/Duration/Current'
  });
  for (const e of manifeste.in) assert.ok(['get', 'subscribe'].includes(e.type));
});

test('manifeste : sorties enregistrées = état, cible, couleur, plan', () => {
  assert.deepEqual(manifeste.out.filter((o) => o.log).map((o) => o.name), ['etat', 'cible', 'couleur', 'plan']);
  for (const o of manifeste.out) {
    assert.match(o.name, /^[a-z][a-zA-Z0-9]*$/);
    if (o.format) assert.ok(FORMATS.includes(o.format), o.format);
  }
});

test('réglages : data.json couvre le manifeste avec des valeurs valides', () => {
  const chemins = manifeste.settings.map((s) => s.path);
  assert.deepEqual(Object.keys(donnees).sort(), [...chemins].sort());
  for (const s of manifeste.settings) {
    const v = donnees[s.path];
    assert.equal(typeof v, 'string', `${s.path} : chaîne attendue (getItem ne rend que des chaînes)`);
    assert.ok(['int', 'float', 'string', 'boolean', 'enum'].includes(s.type));
    if (s.min !== undefined && s.max !== undefined) assert.ok(s.max > s.min, s.path);
    if (s.type === 'int') {
      const n = Number(v);
      assert.ok(Number.isInteger(n) && n >= s.min && n <= s.max, `${s.path} = ${v}`);
    }
    if (s.type === 'enum') assert.ok(Number(v) >= 0 && Number(v) < s.values.length, s.path);
    if (s.type === 'string' && s.maxLength) assert.ok(octets(v) <= s.maxLength, s.path);
  }
});

test('réglages : les configurations types sont complètes et valides', () => {
  const dossier = path.join(DOSSIER_APP, '..', 'configurations');
  const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith('.json'));
  assert.ok(fichiers.length >= 3);
  for (const f of fichiers) {
    const c = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));
    assert.deepEqual(Object.keys(c).sort(), Object.keys(donnees).sort(), f);
    for (const s of manifeste.settings) {
      if (s.type === 'string' && s.maxLength) assert.ok(octets(c[s.path]) <= s.maxLength, `${f} ${s.path}`);
    }
  }
});

// Configuration ESLint du validateur officiel (lib/javascript/validate.js)
function linter() {
  const globals = {};
  for (const g of [...NATIVES, ...GLOBALES]) globals[g] = 'readonly';
  const eslint = new ESLint({
    useEslintrc: false,
    allowInlineConfig: false,
    baseConfig: {
      parserOptions: { ecmaVersion: 5 },
      globals,
      rules: {
        'no-undef': 'warn',
        'no-restricted-globals': ['error', { name: 'Date', message: 'Date object is not supported' },
          ...RAPPELS.map((name) => ({ name, message: `Calling '${name}' is not allowed` }))],
        'id-denylist': ['error', '_e', '_', '_d']
      }
    }
  });
  return eslint;
}

test('main.js : ESLint avec la configuration du validateur officiel (ES5)', async () => {
  const [r] = await linter().lintText(code);
  assert.deepEqual(r.messages.map((m) => `${m.line}:${m.column} ${m.message}`), []);
});

test('témoins : le contrôle rejette bien un code fautif', async () => {
  const fautifs = [
    'var x = new Date();',
    'let y = 1;',
    'var f = (a) => a;',
    'var _ = 1;',
    'var z = inconnue + 1;'
  ];
  for (const f of fautifs) {
    const [r] = await linter().lintText(f);
    assert.ok(r.messages.length > 0, f);
  }
  assert.throws(() => minifier('function evaluate(input, output) { output.inconnue = 1; }\nfunction getUserInterface() { return { template: \'t\' }; }', manifeste));
});

test('main.js : seules les fonctions de rappel sont déclarées « function »', () => {
  const ast = acorn.parse(code, { ecmaVersion: 5, locations: true });
  const vues = new Set();
  const visiter = (n, auPremierNiveau) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'FunctionDeclaration') {
      assert.ok(auPremierNiveau, `fonction imbriquée ${n.id.name} ligne ${n.loc.start.line}`);
      assert.ok(RAPPELS.includes(n.id.name) || NATIVES.includes(n.id.name), `fonction globale ${n.id.name}`);
      assert.ok(!vues.has(n.id.name), `doublon ${n.id.name}`);
      assert.ok(n.params.length <= (n.id.name === 'onEvent' ? 3 : 2), `${n.id.name} : trop de paramètres`);
      vues.add(n.id.name);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      const fils = n.type === 'Program';
      if (Array.isArray(v)) v.forEach((x) => visiter(x, fils));
      else if (v && typeof v.type === 'string') visiter(v, fils);
    }
  };
  visiter(ast, true);
  assert.ok(vues.has('getUserInterface'), 'getUserInterface est obligatoire');
  // Le minifieur ne garde que les « var » et les rappels : rien d'autre au premier niveau
  for (const n of ast.body) assert.ok(['VariableDeclaration', 'FunctionDeclaration'].includes(n.type), n.type);
});

// Sur la Suunto Vertical, un main.js contenant une expression régulière
// est refusé à la compilation (journal de la montre : « ERR DUKTAPE :
// Compiling js failed: SyntaxError », puis « Zapp load failed »), alors
// que le minifieur, Node et ESLint l'acceptent. La montre affiche alors un
// trompeur « nombre maximal d'apps SuuntoPlus activées ».
test('main.js : aucune expression régulière (refusées par la montre)', () => {
  const regex = [];
  const ast = acorn.parse(code, { ecmaVersion: 5, locations: true });
  const visiter = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Literal' && n.regex) regex.push(`/${n.regex.pattern}/ ligne ${n.loc.start.line}`);
    if ((n.type === 'NewExpression' || n.type === 'CallExpression') && n.callee.name === 'RegExp') {
      regex.push(`RegExp() ligne ${n.loc.start.line}`);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visiter);
      else if (v && typeof v.type === 'string') visiter(v);
    }
  };
  visiter(ast);
  assert.deepEqual(regex, []);
});

test('main.js : passe la transformation du minifieur (noms d\'entrées/sorties connus)', () => {
  assert.doesNotThrow(() => minifier(code, manifeste));
});

test('main.js : indications sonores existantes', () => {
  for (const m of code.matchAll(/var VIB_\w+ = '(\w+)'/g)) assert.ok(INDICATIONS.includes(m[1]), m[1]);
});

// ---------------------------------------------------------------------
// Écrans HTML
// ---------------------------------------------------------------------

// Découpe en balises en respectant les guillemets (les attributs contiennent du JS)
function balises(html) {
  const sans = html.replace(/<!--[\s\S]*?-->/g, '');
  const res = [];
  let i = 0;
  while ((i = sans.indexOf('<', i)) >= 0) {
    let j = i + 1;
    let q = null;
    for (; j < sans.length; j++) {
      const c = sans[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === '\'') q = c;
      else if (c === '>') break;
    }
    const brut = sans.slice(i + 1, j).trim();
    const m = /^(\/?)([:\w.-]+)([\s\S]*?)(\/?)$/.exec(brut);
    assert.ok(m, `balise illisible : <${brut}>`);
    const attributs = {};
    for (const a of m[3].matchAll(/([\w.:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'))?/g)) {
      attributs[a[1]] = a[3] ?? a[4] ?? true;
    }
    res.push({ nom: m[2], fermante: m[1] === '/', autoFermante: m[4] === '/', attributs });
    i = j + 1;
  }
  return res;
}

const ATTRIBUTS = {
  uiView: ['class', 'id', 'style', 'onLoad', 'onActivate', 'onDeactivate', 'onTap'],
  uiViewSet: ['class', 'id', 'style', 'onIdle', 'onTap', 'orientation', 'rollOver', 'transition.duration', 'transition.timing', 'transition.type'],
  div: ['class', 'id', 'style', 'optional', 'onTap'],
  span: ['class', 'id', 'style', 'optional'],
  eval: ['input', 'outputFormat', 'default'],
  userInput: [],
  pushButton: ['name', 'type', 'longType', 'longPressDuration', 'onClick', 'onLongPress', 'onLongPressStart'],
  ':if': ['test'],
  ':else': [],
  ':dialog': ['textBody', 'btnTopText', 'btnBtmText', 'btnBtmShapeClass', 'btnTopShapeClass']
};
const ICONES_UI2 = ['F101', 'F103', 'F160', 'F263', 'F266', 'F267', 'E335'];
const sortiesManifeste = new Set(manifeste.out.map((o) => o.name));

for (const { name: fichier } of manifeste.template) {
  test(`écran ${fichier} : structure, sorties, formats et boutons`, () => {
    const html = lire(fichier);
    const liste = balises(html);
    // une seule racine uiView, balises équilibrées
    const pile = [];
    let racines = 0;
    for (const b of liste) {
      assert.ok(b.nom in ATTRIBUTS, `élément non prévu <${b.nom}>`);
      if (b.fermante) {
        assert.equal(pile.pop(), b.nom, `fermeture </${b.nom}> inattendue`);
        continue;
      }
      for (const a of Object.keys(b.attributs)) {
        assert.ok(ATTRIBUTS[b.nom].includes(a), `<${b.nom} ${a}> non prévu`);
      }
      if (b.nom === 'uiView' && pile.length === 0) racines++;
      if (!b.autoFermante) pile.push(b.nom);
    }
    assert.deepEqual(pile, [], 'balises non fermées');
    assert.equal(racines, 1, 'une seule racine uiView');

    // sorties lues par l'écran
    for (const m of html.matchAll(/Zapp\/\{zapp_index\}\/Output\/(\w+)/g)) {
      assert.ok(sortiesManifeste.has(m[1]), `sortie inconnue ${m[1]}`);
    }
    // formats des <eval>
    for (const b of liste.filter((x) => x.nom === 'eval')) {
      const f = b.attributs.outputFormat;
      assert.ok(FORMATS.includes(f) || f.startsWith('script x => '), f);
      if (f.startsWith('script')) assert.doesNotThrow(() => new Function('x', `return (${f.slice(7)})(x);`));
    }
    // événements envoyés à main.js : 1 à 5
    for (const m of html.matchAll(/Event', (\d+), null, 'int32'/g)) {
      assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= 5, m[1]);
      assert.match(code, new RegExp(`eventId == ${m[1]}`));
    }
    // icônes de la police SuuntoPlus (UI2, petite taille)
    for (const m of html.matchAll(/&#x([0-9A-F]{4});/g)) assert.ok(ICONES_UI2.includes(m[1]), m[1]);
    // pas de '<' ni de '&&' dans le JS des attributs (XML)
    for (const b of liste) {
      for (const v of Object.values(b.attributs)) {
        if (typeof v === 'string') assert.ok(!v.includes('<') && !v.includes('&&'), v);
      }
    }
    // gabarit connu de main.js
    assert.match(code, new RegExp(`'${fichier.replace('.html', '')}'`));
  });
}

test('écran principal : chaque vue de l\'en-tête correspond à un index de main.js', () => {
  const html = lire('t.html');
  const hd = html.slice(html.indexOf('<uiViewSet id="hd"'), html.indexOf('</uiViewSet>'));
  const vues = hd.match(/<!-- \d+/g).length + 1; // « 9 et 10 » partagent un commentaire
  assert.equal(vues, 11);
  assert.match(code, /var H_PLAN_B = 10;/);
});
