import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../../js/model-rules.js';
import { TEMPLATES } from '../../js/store/templates.js';
import { LIBRARY } from '../../js/store/template-library.js';
import * as state from '../../js/state.js';
import { LIMITS, ValidationError, findParentCycle, isValidEmail, isValidPassword, normalizeBoardName, normalizeDisplayName, normalizeEmail, prepareBoard, prepareImport, validateItem, validateSet } from '../src/validate.js';
import { sticky } from './helpers.js';

const text = (id = 'a', extra = {}) => ({ id, type: 'text', x: 0, y: 0, content: '', ...extra });
const kanban = (columns, extra = {}) => ({ id: 'k', type: 'kanban', x: 0, y: 0, columns, ...extra });
const code = fn => {
  try { fn(); return 'ok'; } catch (err) {
    assert.ok(err instanceof ValidationError, err.stack);
    return err.code;
  }
};
const itemCode = item => validateItem(item)?.code ?? 'ok';
const boardCode = data => code(() => prepareBoard(data));
const importCode = data => code(() => prepareImport(data));

/* Un objet JSON reçu tel quel : `__proto__` y est une vraie clé, pas le prototype. */
const parsed = json => JSON.parse(json);

function table(title, cases) {
  describe(title, () => {
    for (const [name, value, expected] of cases) {
      it(`${name} : ${expected}`, () => assert.equal(itemCode(value), expected));
    }
  });
}

describe('modules partagés sans DOM', () => {
  it('se chargent sans document ni window ni localStorage', () => {
    assert.equal(typeof document, 'undefined');
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof localStorage, 'undefined');
  });

  it('state.js réexporte les règles sans changement pour ses appelants', () => {
    for (const name of ['PALETTE', 'SHAPES', 'TYPES', 'SAFE_ID', 'ID_REFS', 'sanitizeIds']) {
      assert.equal(state[name], rules[name], name);
    }
    assert.equal(state.COLORS.light_yellow, 'Jaune clair');
    assert.equal(Object.keys(state.COLORS).length, rules.PALETTE.length);
  });

  it('sanitizeIds garde son comportement', () => {
    const items = [{ id: 'bon-id', parent: 'x"y', targetId: 'ok' }, { id: 5 }];
    rules.sanitizeIds(items);
    assert.deepEqual(items, [{ id: 'bon-id', parent: null, targetId: 'ok' }, { id: 'item-import-2' }]);
  });
});

describe('corpus réel : tous les modèles de l’application', () => {
  const all = [...TEMPLATES, ...LIBRARY];

  it('contient bien des modèles', () => assert.ok(all.length > 50));

  it('passent l’import tels quels', () => {
    for (const t of all) assert.equal(importCode(t.données()), 'ok', t.id);
  });

  it('passent la validation stricte une fois normalisés par le client', () => {
    for (const t of all) {
      const data = t.données();
      data.items.forEach(state.normalizeItem);
      assert.equal(boardCode(data), 'ok', t.id);
    }
  });
});

table('objet valide', [
  ['post-it', sticky('a'), 'ok'],
  ['forme', text('a', { type: 'shape', shape: 'circle' }), 'ok'],
  ['code', text('a', { type: 'code', language: 'python' }), 'ok'],
  ['champ futur inconnu', text('a', { futur_champ2: { a: [1, 'b'] } }), 'ok'],
  ['référence nulle', text('a', { parent: null, targetId: null }), 'ok'],
  ['réaction connue', text('a', { reactions: { '❤️': ['Claire'], '👍': [] } }), 'ok']
]);

table('clés interdites', [
  ['__proto__ en premier niveau', parsed('{"id":"a","type":"text","x":0,"y":0,"__proto__":{"x":1}}'), 'forbidden_key'],
  ['constructor en premier niveau', text('a', { constructor: { prototype: {} } }), 'forbidden_key'],
  ['prototype en premier niveau', text('a', { prototype: 1 }), 'forbidden_key'],
  ['__proto__ imbriqué dans un objet', parsed('{"id":"a","type":"text","x":0,"y":0,"z":{"y":{"__proto__":{}}}}'), 'forbidden_key'],
  ['__proto__ dans un tableau', parsed('{"id":"a","type":"text","x":0,"y":0,"z":[[{"__proto__":{}}]]}'), 'forbidden_key'],
  ['constructor dans une colonne', parsed('{"id":"k","type":"kanban","x":0,"y":0,"columns":[{"id":"c","name":"n","cards":[],"constructor":1}]}'), 'forbidden_key'],
  ['prototype dans une réaction', parsed('{"id":"a","type":"text","x":0,"y":0,"reactions":{"prototype":[]}}'), 'forbidden_key'],
  ['clé commençant par un chiffre', text('a', { '1champ': 1 }), 'invalid_key'],
  ['clé commençant par un souligné', text('a', { _champ: 1 }), 'invalid_key'],
  ['clé avec tiret', text('a', { 'mon-champ': 1 }), 'invalid_key'],
  ['clé accentuée', text('a', { 'données': 1 }), 'invalid_key'],
  ['clé de 41 caractères', text('a', { ['a'.repeat(41)]: 1 }), 'invalid_key'],
  ['clé de 40 caractères', text('a', { ['a'.repeat(40)]: 1 }), 'ok']
]);

table('identifiants', [
  ['id absent', { type: 'text', x: 0, y: 0 }, 'invalid_id'],
  ['id numérique', text(5), 'invalid_id'],
  ['id avec guillemet', text('a"]'), 'invalid_id'],
  ['id avec espace', text('a b'), 'invalid_id'],
  ['id vide', text(''), 'invalid_id'],
  ['id avec retour à la ligne', text('a\n'), 'invalid_id'],
  ['id trop long', text('a'.repeat(129)), 'invalid_id'],
  ...rules.ID_REFS.flatMap(ref => [
    [`${ref} invalide`, text('a', { [ref]: 'x"]' }), 'invalid_id'],
    [`${ref} non textuel`, text('a', { [ref]: 12 }), 'invalid_id'],
    [`${ref} vers lui-même`, text('a', { [ref]: 'a' }), 'self_reference'],
    [`${ref} vers un autre`, text('a', { [ref]: 'b' }), 'ok']
  ]),
  ['columns[].id invalide', kanban([{ id: 'c"', name: 'n', cards: [] }]), 'invalid_id'],
  ['cards[].id invalide', kanban([{ id: 'c', name: 'n', cards: [{ id: 'x y', text: '' }] }]), 'invalid_id'],
  ['cards[].id absent', kanban([{ id: 'c', name: 'n', cards: [{ text: '' }] }]), 'invalid_id'],
  ['colonnes en double', kanban([{ id: 'c', name: 'n', cards: [] }, { id: 'c', name: 'm', cards: [] }]), 'duplicate_id'],
  ['carte et colonne en double', kanban([{ id: 'c', name: 'n', cards: [{ id: 'c', text: '' }] }]), 'duplicate_id'],
  ['tags[] invalide', text('a', { tags: ['ok', 'pas"ok'] }), 'invalid_id'],
  ['tags[] non textuel', text('a', { tags: [1] }), 'invalid_id']
]);

table('énumérations', [
  ['type inconnu', text('a', { type: 'script' }), 'invalid_enum'],
  ['type constructor', text('a', { type: 'constructor' }), 'invalid_enum'],
  ['type __proto__', text('a', { type: '__proto__' }), 'invalid_enum'],
  ['type absent', { id: 'a', x: 0, y: 0 }, 'invalid_enum'],
  ['color inconnue', sticky('a', { color: 'x"]' }), 'invalid_enum'],
  ['color héritée, stricte', sticky('a', { color: 'yellow' }), 'invalid_enum'],
  ['color non textuelle', sticky('a', { color: 3 }), 'invalid_enum'],
  ['shape inconnue', text('a', { shape: 'hexagon' }), 'invalid_enum'],
  ['shape toString', text('a', { shape: 'toString' }), 'invalid_enum'],
  ['language inconnu', text('a', { language: 'cobol' }), 'invalid_enum'],
  ['language constructor', text('a', { language: 'constructor' }), 'invalid_enum'],
  ['stroke de ligne inconnu', { id: 'a', type: 'connector', stroke: 'ink' }, 'invalid_enum'],
  ['stroke de ligne connu', { id: 'a', type: 'connector', stroke: 'violet' }, 'ok'],
  ['stroke de dessin inconnu', text('a', { type: 'drawing', stroke: 'auto' }), 'invalid_enum'],
  ['stroke de dessin connu', text('a', { type: 'drawing', stroke: 'ink' }), 'ok'],
  ['stroke sur un autre type', text('a', { stroke: 'ink' }), 'invalid_enum'],
  ['lineType inconnu', { id: 'a', type: 'connector', lineType: 'wave' }, 'invalid_enum'],
  ['lineType hérité, strict', { id: 'a', type: 'connector', lineType: 'arrow' }, 'invalid_enum'],
  ['lineStyle inconnu', { id: 'a', type: 'connector', lineStyle: 'wavy' }, 'invalid_enum'],
  ['startCap inconnu', { id: 'a', type: 'connector', startCap: 'x' }, 'invalid_enum'],
  ['endCap inconnu', { id: 'a', type: 'connector', endCap: 'constructor' }, 'invalid_enum'],
  ['réaction inconnue', text('a', { reactions: { '💀': ['Claire'] } }), 'invalid_enum'],
  ['align inconnu', text('a', { align: 'justify' }), 'invalid_enum'],
  ['size inconnue', sticky('a', { size: 'xl' }), 'invalid_enum']
]);

table('nombres', [
  ['Infinity', text('a', { x: Infinity }), 'out_of_range'],
  ['NaN', text('a', { y: NaN }), 'out_of_range'],
  ['JSON 1e999', parsed('{"id":"a","type":"text","x":1e999,"y":0}'), 'out_of_range'],
  ['x au-delà de 10^7', text('a', { x: 1e7 + 1 }), 'out_of_range'],
  ['y en deçà de -10^7', text('a', { y: -1e7 - 1 }), 'out_of_range'],
  ['x à 10^7 exactement', text('a', { x: 1e7 }), 'ok'],
  ['x à -10^7 exactement', text('a', { x: -1e7 }), 'ok'],
  ['nombre imbriqué hors limites', text('a', { z: { y: [1e8] } }), 'out_of_range'],
  ['width négative', text('a', { width: -1 }), 'out_of_range'],
  ['width au-delà de 10^5', text('a', { width: 1e5 + 1 }), 'out_of_range'],
  ['height au-delà de 10^5', text('a', { height: 1e5 + 1 }), 'out_of_range'],
  ['width à 0', text('a', { width: 0 }), 'ok'],
  ['height à 10^5', text('a', { height: 1e5 }), 'ok'],
  ['x textuel', text('a', { x: '10' }), 'invalid_data'],
  ['width textuelle', text('a', { width: '100' }), 'invalid_data'],
  ['x absent', { id: 'a', type: 'text', y: 0 }, 'missing_structure'],
  ['ligne sans position', { id: 'a', type: 'connector' }, 'ok'],
  ['fontSize auto', text('a', { fontSize: 'auto' }), 'ok'],
  ['fontSize textuelle', text('a', { fontSize: '12px' }), 'invalid_data']
]);

table('champs structurels', [
  ['kanban sans colonnes', { id: 'k', type: 'kanban', x: 0, y: 0 }, 'missing_structure'],
  ['kanban, colonnes non listées', kanban({}), 'missing_structure'],
  ['colonne sans cartes', kanban([{ id: 'c', name: 'n' }]), 'missing_structure'],
  ['tableau sans lignes', { id: 'd', type: 'datatable', x: 0, y: 0 }, 'missing_structure'],
  ['tableau, lignes non listées', { id: 'd', type: 'datatable', x: 0, y: 0, rows: 'a' }, 'missing_structure'],
  ['commentaire sans messages', { id: 'c', type: 'comment', x: 0, y: 0 }, 'missing_structure'],
  ['commentaire, messages non listés', { id: 'c', type: 'comment', x: 0, y: 0, messages: {} }, 'missing_structure'],
  ['message sans date valide', { id: 'c', type: 'comment', x: 0, y: 0, messages: [{ author: 'A', text: 't', date: 'hier' }] }, 'invalid_data'],
  ['message sans auteur', { id: 'c', type: 'comment', x: 0, y: 0, messages: [{ text: 't', date: '2026-01-01' }] }, 'invalid_data'],
  ['cellule objet', { id: 'd', type: 'datatable', x: 0, y: 0, rows: [[{}]] }, 'invalid_data'],
  ['ligne non listée', { id: 'd', type: 'datatable', x: 0, y: 0, rows: ['a'] }, 'invalid_data'],
  ['content non textuel', text('a', { content: 5 }), 'invalid_data'],
  ['locked non booléen', text('a', { locked: 'oui' }), 'invalid_data'],
  ['point sans y', { id: 'l', type: 'connector', start: { x: 1 } }, 'invalid_data'],
  ['waypoint textuel', { id: 'l', type: 'connector', waypoints: ['1,2'] }, 'invalid_data'],
  ['points non numériques', text('a', { type: 'drawing', points: [1, 'a'] }), 'invalid_data'],
  ['points impairs', text('a', { type: 'drawing', points: [1, 2, 3] }), 'invalid_data'],
  ['réactions non objet', text('a', { reactions: [] }), 'invalid_data'],
  ['auteurs de réaction non listés', text('a', { reactions: { '👍': 'Claire' } }), 'invalid_data'],
  ['profondeur excessive', text('a', { z: JSON.parse(`${'['.repeat(40)}${']'.repeat(40)}`) }), 'invalid_data']
]);

const fill = (n, make) => Array.from({ length: n }, (_, i) => make(i));
table('tailles', [
  ['texte de 50 000 caractères', text('a', { content: 'x'.repeat(50000) }), 'ok'],
  ['texte de 50 001 caractères', text('a', { content: 'x'.repeat(50001) }), 'too_long'],
  ['texte imbriqué trop long', text('a', { z: ['x'.repeat(50001)] }), 'too_long'],
  ['libellé de 200 caractères', { id: 'l', type: 'connector', label: 'é'.repeat(200) }, 'ok'],
  ['libellé de 201 caractères', { id: 'l', type: 'connector', label: 'é'.repeat(201) }, 'too_long'],
  ['nom de colonne trop long', kanban([{ id: 'c', name: 'x'.repeat(201), cards: [] }]), 'too_long'],
  ['auteur de message trop long', { id: 'c', type: 'comment', x: 0, y: 0, messages: [{ author: 'x'.repeat(201), text: 't', date: '2026-01-01' }] }, 'too_long'],
  ['objet de plus de 128 Kio', text('a', { content: 'x'.repeat(50000), back: 'x'.repeat(50000), title: 'x'.repeat(50000) }), 'too_large'],
  ['10 000 coordonnées', text('a', { type: 'drawing', points: fill(10000, () => 1) }), 'ok'],
  ['10 002 coordonnées', text('a', { type: 'drawing', points: fill(10002, () => 1) }), 'too_many'],
  ['200 points de pliage', { id: 'l', type: 'connector', waypoints: fill(200, () => ({ x: 1, y: 1 })) }, 'ok'],
  ['201 points de pliage', { id: 'l', type: 'connector', waypoints: fill(201, () => ({ x: 1, y: 1 })) }, 'too_many'],
  ['50 colonnes', kanban(fill(50, i => ({ id: `c${i}`, name: 'n', cards: [] }))), 'ok'],
  ['51 colonnes', kanban(fill(51, i => ({ id: `c${i}`, name: 'n', cards: [] }))), 'too_many'],
  ['500 cartes', kanban([{ id: 'c', name: 'n', cards: fill(500, i => ({ id: `k${i}`, text: '' })) }]), 'ok'],
  ['501 cartes', kanban([{ id: 'c', name: 'n', cards: fill(501, i => ({ id: `k${i}`, text: '' })) }]), 'too_many'],
  ['200 lignes de 50 colonnes', { id: 'd', type: 'datatable', x: 0, y: 0, rows: fill(200, () => fill(50, () => '')) }, 'ok'],
  ['201 lignes', { id: 'd', type: 'datatable', x: 0, y: 0, rows: fill(201, () => ['']) }, 'too_many'],
  ['51 colonnes de tableau', { id: 'd', type: 'datatable', x: 0, y: 0, rows: [fill(51, () => '')] }, 'too_many'],
  ['500 messages', { id: 'c', type: 'comment', x: 0, y: 0, messages: fill(500, () => ({ author: 'A', text: 't', date: '2026-01-01' })) }, 'ok'],
  ['501 messages', { id: 'c', type: 'comment', x: 0, y: 0, messages: fill(501, () => ({ author: 'A', text: 't', date: '2026-01-01' })) }, 'too_many'],
  ['201 étiquettes sur un objet', text('a', { tags: fill(201, i => `t${i}`) }), 'too_many']
]);

describe('tableau entier', () => {
  const mind = (id, parentNode) => ({ id, type: 'mindmap', x: 0, y: 0, content: '', parentNode });

  it('accepte un arbre de parentNode et des références pendantes', () => {
    assert.equal(boardCode({ items: [mind('r', null), mind('a', 'r'), mind('b', 'a'), mind('c', 'absent')] }), 'ok');
  });

  it('refuse un cycle de parentNode, de toute longueur, en tout point du tableau', () => {
    assert.equal(boardCode({ items: [mind('a', 'b'), mind('b', 'a')] }), 'parent_cycle');
    assert.equal(boardCode({ items: [mind('r', null), mind('a', 'c'), mind('b', 'a'), mind('c', 'b'), mind('d', 'c')] }), 'parent_cycle');
    assert.equal(boardCode({ items: [text('a', { parentNode: 'b' }), text('b', { parentNode: 'a' })] }), 'parent_cycle');
    assert.equal(importCode({ items: [mind('a', 'b'), mind('b', 'a')] }), 'parent_cycle');
    assert.equal(findParentCycle([mind('r', null), mind('a', 'r')]), null);
  });

  it('détecte un long cycle et borne la profondeur parentale', () => {
    const items = fill(5000, i => mind(`n${i}`, `n${(i + 1) % 5000}`));
    assert.equal(boardCode({ items }), 'parent_cycle');
    const chain = fill(66, i => mind(`n${i}`, i ? `n${i - 1}` : null));
    assert.equal(boardCode({ items: chain }), 'parent_depth');
    const imported = prepareImport({ items: chain });
    assert.equal(boardCode({ items: imported.items }), 'ok');
    assert.equal(imported.items[65].parentNode, undefined);
  });

  it('refuse les identifiants d’objets en double', () => {
    assert.equal(boardCode({ items: [text('a'), text('a')] }), 'duplicate_id');
  });

  it('borne le nombre d’objets et le poids total', () => {
    assert.equal(boardCode({ items: fill(5000, i => text(`i${i}`)) }), 'ok');
    assert.equal(boardCode({ items: fill(5001, i => text(`i${i}`)) }), 'too_many');
    assert.equal(importCode({ items: fill(5001, i => text(`i${i}`)) }), 'too_many');
    const heavy = fill(90, i => text(`i${i}`, { content: 'x'.repeat(50000) }));
    assert.equal(boardCode({ items: heavy }), 'too_large');
  });

  it('vérifie étiquettes, ordre des cadres, fond et nom', () => {
    const items = [];
    const tag = { id: 't', name: 'Nom', color: 'red' };
    assert.equal(boardCode({ items, tags: [tag] }), 'ok');
    assert.equal(boardCode({ items, tags: [{ ...tag, id: 't"' }] }), 'invalid_id');
    assert.equal(boardCode({ items, tags: [{ ...tag, color: 'light_yellow' }] }), 'invalid_enum');
    assert.equal(boardCode({ items, tags: [{ ...tag, name: 'x'.repeat(201) }] }), 'too_long');
    assert.equal(boardCode({ items, tags: [tag, tag] }), 'duplicate_id');
    assert.equal(boardCode({ items, tags: fill(200, i => ({ ...tag, id: `t${i}` })) }), 'ok');
    assert.equal(boardCode({ items, tags: fill(201, i => ({ ...tag, id: `t${i}` })) }), 'too_many');
    assert.equal(boardCode({ items, tags: 'non' }), 'invalid_data');
    assert.equal(boardCode({ items, frameOrder: ['f', 'x y'] }), 'invalid_id');
    assert.equal(boardCode({ items, frameOrder: 'f' }), 'invalid_data');
    assert.equal(boardCode({ items, background: 'night' }), 'ok');
    assert.equal(boardCode({ items, background: 'x"' }), 'invalid_enum');
    assert.equal(boardCode({ items, background: 'constructor' }), 'invalid_enum');
    assert.equal(boardCode({ items, name: 'x'.repeat(201) }), 'too_long');
    assert.equal(boardCode({ items, name: 5 }), 'invalid_data');
  });

  it('refuse les clés interdites au niveau du tableau et dans ses métadonnées', () => {
    assert.equal(boardCode(parsed('{"items":[],"__proto__":{}}')), 'forbidden_key');
    assert.equal(importCode(parsed('{"items":[],"constructor":{}}')), 'forbidden_key');
    assert.equal(boardCode(parsed('{"items":[],"tags":[{"id":"t","name":"n","color":"red","__proto__":{}}]}')), 'forbidden_key');
  });

  it('n’interprète pas les champs inconnus du tableau et n’en garde aucun', () => {
    const out = prepareBoard({ items: [], rev: 12, createdAt: Date.now(), inconnu: 1e12, tags: [] });
    assert.deepEqual(Object.keys(out.meta), ['tags']);
    assert.deepEqual(prepareImport({ items: [], autre: 1e12 }).meta, { tags: [] });
  });

  it('exige la liste d’objets en strict, la tolère absente à l’import', () => {
    assert.equal(boardCode({}), 'missing_structure');
    assert.equal(boardCode(null), 'invalid_data');
    assert.equal(importCode({}), 'ok');
    assert.equal(importCode(undefined), 'ok');
    assert.equal(importCode({ items: [null] }), 'invalid_data');
    assert.equal(importCode('x'), 'invalid_data');
  });

  it('ne répare à l’import que ce que le format historique autorise', () => {
    assert.equal(prepareImport({ items: [text('a b')] }).items[0].id, 'item-import-1');
    assert.equal(prepareImport({ items: [sticky('a', { color: 'purple' })] }).items[0].color, 'violet');
    assert.equal(importCode({ items: [sticky('a', { color: 'constructor' })] }), 'invalid_enum');
    assert.equal(importCode({ items: [kanban([{ id: 'c"', name: 'n', cards: [] }])] }), 'invalid_id');
    assert.equal(importCode({ items: [text('a'), text('a')] }), 'duplicate_id');
    assert.equal(importCode({ items: [text('a', { x: Infinity })] }), 'out_of_range');
    assert.equal(importCode({ items: [{ id: 'k', type: 'constructor', x: 0, y: 0 }] }), 'invalid_enum');
  });

  it('refuse un objet à la place d’une valeur simple, sans lever d’exception inattendue', () => {
    const hostile = '{"toString":1,"valueOf":1}';
    for (const field of ['parent', 'targetId']) {
      assert.equal(importCode(parsed(`{"items":[{"id":"a","type":"text","x":0,"y":0,"${field}":${hostile}}]}`)), 'invalid_data', field);
    }
    for (const field of ['strokeWidth', 'startCap', 'endCap']) {
      assert.equal(importCode(parsed(`{"items":[{"id":"a","type":"connector","${field}":${hostile}}]}`)), 'invalid_data', field);
    }
    assert.equal(importCode(parsed(`{"items":[{"id":${hostile},"type":"text","x":0,"y":0}]}`)), 'ok');
    assert.equal(importCode(parsed(`{"items":[{"id":"a","type":${hostile},"x":0,"y":0}]}`)), 'invalid_enum');
  });

  it('borne le chemin renvoyé même si une clé est démesurée', () => {
    const err = validateItem(text('a', { ['k'.repeat(5000)]: 1 }));
    assert.equal(err.code, 'invalid_key');
    assert.equal(err.path.length, 200);
  });

  it('ne modifie pas les données reçues', () => {
    const data = { items: [{ id: 'l', type: 'connector', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }] };
    const before = JSON.stringify(data);
    prepareBoard(data);
    prepareImport(data);
    assert.equal(JSON.stringify(data), before);
  });

  it('sépare le chemin de l’erreur du message affichable', () => {
    assert.throws(() => prepareBoard({ items: [text('a'), text('b', { color: 'x' })] }), err => err.path === 'data.items[1].color' && err.message === 'Couleur inconnue');
  });

  it('expose les limites du document', () => {
    assert.equal(LIMITS.boardItems, 5000);
    assert.equal(LIMITS.boardBytes, 4194304);
    assert.equal(LIMITS.itemBytes, 131072);
  });
});

describe('opération set', () => {
  const setCode = (...args) => validateSet(...args)?.code ?? 'ok';
  const k = () => kanban([{ id: 'c', name: 'n', cards: [] }]);

  it('type et identifiant immuables', () => {
    assert.equal(setCode(text('a'), { type: 'shape' }), 'immutable');
    assert.equal(setCode(text('a'), { id: 'b' }), 'immutable');
    assert.equal(setCode(text('a'), {}, ['type']), 'immutable');
    assert.equal(setCode(text('a'), { type: 'text', content: 'x' }), 'ok');
  });

  it('champs structurels non supprimables', () => {
    assert.equal(setCode(k(), {}, ['columns']), 'missing_structure');
    assert.equal(setCode({ id: 'd', type: 'datatable', x: 0, y: 0, rows: [] }, {}, ['rows']), 'missing_structure');
    assert.equal(setCode({ id: 'c', type: 'comment', x: 0, y: 0, messages: [] }, {}, ['messages']), 'missing_structure');
    assert.equal(setCode(k(), { columns: 'non' }), 'missing_structure');
    assert.equal(setCode(text('a', { bold: true }), {}, ['bold']), 'ok');
  });

  it('clés interdites et valeurs revalidées', () => {
    assert.equal(setCode(text('a'), parsed('{"__proto__":{"x":1}}')), 'forbidden_key');
    assert.equal(setCode(text('a'), {}, ['__proto__']), 'forbidden_key');
    assert.equal(setCode(text('a'), { x: 1e8 }), 'out_of_range');
    assert.equal(setCode(text('a'), { parent: 'a' }), 'self_reference');
    assert.equal(setCode(text('a'), {}, ['x']), 'missing_structure');
    assert.equal(setCode(text('a'), 'non'), 'invalid_data');
    assert.equal(setCode(text('a'), {}, 'non'), 'invalid_data');
  });

  it('refuse un cycle créé par l’écriture', () => {
    const items = [text('a'), text('b', { parentNode: 'a' })];
    assert.equal(setCode(items[0], { parentNode: 'b' }, [], items), 'parent_cycle');
    assert.equal(setCode(items[0], { content: 'x' }, [], items), 'ok');
  });
});

describe('champs de compte', () => {
  it('normalise l’e-mail : espaces, casse, NFKC', () => {
    assert.equal(normalizeEmail('  ClaIRE@Exemple.FR '), 'claire@exemple.fr');
    assert.equal(normalizeEmail('Ａ@exemple.fr'), 'a@exemple.fr');
    assert.equal(normalizeEmail(5), '');
  });

  it('borne l’e-mail', () => {
    assert.equal(isValidEmail('a@b.fr'), true);
    assert.equal(isValidEmail('a@b'), false);
    assert.equal(isValidEmail('a b@c.fr'), false);
    assert.equal(isValidEmail(''), false);
    assert.equal(isValidEmail(`${'a'.repeat(250)}@b.fr`), false);
    assert.equal(isValidEmail('a<b>@c.fr'), false);
  });

  it('borne le mot de passe en caractères, sans règle de composition', () => {
    assert.equal(isValidPassword('a'.repeat(11)), false);
    assert.equal(isValidPassword('a'.repeat(12)), true);
    assert.equal(isValidPassword('😀'.repeat(128)), true);
    assert.equal(isValidPassword('😀'.repeat(129)), false);
    assert.equal(isValidPassword(null), false);
  });

  it('borne les noms', () => {
    assert.equal(normalizeDisplayName(' Élodie '), 'Élodie');
    assert.equal(normalizeDisplayName('x'.repeat(50)).length, 50);
    assert.equal(normalizeDisplayName('x'.repeat(51)), null);
    assert.equal(normalizeDisplayName('   '), null);
    assert.equal(normalizeDisplayName(5), null);
    assert.equal(normalizeDisplayName('a\u0000b'), null);
    assert.equal(normalizeDisplayName('Élodie'), 'Élodie');
    assert.equal(normalizeDisplayName('a\u200Bb'), null);
    assert.equal(normalizeBoardName('x'.repeat(200)).length, 200);
    assert.equal(normalizeBoardName('x'.repeat(201)), null);
  });
});
