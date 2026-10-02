import { describe, it, expect, beforeEach } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';
import { clearWebSQLCache } from '../src/browser/js/web-sql-bindings';
import type { JSObject } from '../src/browser/js/values';

/** Guest JSObjects carry values in a `properties` Map — flatten one to a plain object for assertions. */
function plain(obj: unknown): Record<string, unknown> {
  const props = (obj as JSObject).properties;
  const out: Record<string, unknown> = {};
  for (const [key, desc] of props) out[key] = desc.value;
  return out;
}

function setup(origin = 'https://example.com') {
  const htmlParser = new HtmlParser();
  const domTree = new DomTree();
  const parseResult = htmlParser.parse('<html><body></body></html>', origin + '/');
  const doc = domTree.buildFromHtml(parseResult.document);
  const eventLoop = new EventLoop();
  const globalEnv = createGlobalEnv(doc, domTree, eventLoop, undefined, undefined, undefined, undefined, origin);
  return { doc, domTree, eventLoop, globalEnv };
}

describe('window.openDatabase (real page-script pipeline)', () => {
  beforeEach(() => {
    clearWebSQLCache();
  });

  it('creates a table, inserts a row, and reads it back through executeSql callbacks', () => {
    const { doc, domTree, eventLoop, globalEnv } = setup();
    const source = `
      var db = openDatabase('todos', '1.0', 'Todos', 2 * 1024 * 1024);
      var readBack = null;
      db.transaction(function (tx) {
        tx.executeSql('CREATE TABLE IF NOT EXISTS todo (id, text)');
        tx.executeSql('INSERT INTO todo (id, text) VALUES (?, ?)', [1, 'buy milk']);
        tx.executeSql('SELECT * FROM todo', [], function (tx, results) {
          readBack = results.rows.item(0);
        });
      });
    `;
    const result = runJS(source, { document: doc, domTree, eventLoop, globalEnv });
    expect(result.error).toBeUndefined();

    eventLoop.drainMicrotasks();

    const readBack = globalEnv.get('readBack');
    expect(plain(readBack)).toEqual({ id: 1, text: 'buy milk' });
  });

  it('surfaces a real SQL error to the error callback with a numeric code', () => {
    const { doc, domTree, eventLoop, globalEnv } = setup();
    const source = `
      var db = openDatabase('errdb', '1.0', 'Err', 1024);
      var errorCode = null;
      db.transaction(function (tx) {
        tx.executeSql('SELECT * FROM does_not_exist', [], null, function (tx, error) {
          errorCode = error.code;
          return false;
        });
      });
    `;
    runJS(source, { document: doc, domTree, eventLoop, globalEnv });
    eventLoop.drainMicrotasks();
    expect(globalEnv.get('errorCode')).toBe(1); // SQLError.DATABASE_ERR
  });

  it('a readTransaction rejects an INSERT via its error callback', () => {
    const { doc, domTree, eventLoop, globalEnv } = setup();
    const source = `
      var db = openDatabase('rodb', '1.0', 'RO', 1024);
      var setupDone = false;
      var readOnlyBlocked = false;
      db.transaction(function (tx) {
        tx.executeSql('CREATE TABLE t (a)', [], function () { setupDone = true; });
      });
    `;
    runJS(source, { document: doc, domTree, eventLoop, globalEnv });
    eventLoop.drainMicrotasks();
    expect(globalEnv.get('setupDone')).toBe(true);

    const source2 = `
      db.readTransaction(function (tx) {
        tx.executeSql('INSERT INTO t (a) VALUES (?)', [1], null, function () { readOnlyBlocked = true; return false; });
      });
    `;
    runJS(source2, { document: doc, domTree, eventLoop, globalEnv });
    eventLoop.drainMicrotasks();
    expect(globalEnv.get('readOnlyBlocked')).toBe(true);
  });

  it('data persists across a second openDatabase call for the same name', () => {
    const { doc, domTree, eventLoop, globalEnv } = setup();
    const source = `
      var db1 = openDatabase('persistdb', '1.0', 'P', 1024);
      db1.transaction(function (tx) {
        tx.executeSql('CREATE TABLE t (a)');
        tx.executeSql('INSERT INTO t (a) VALUES (?)', ['hello']);
      });
    `;
    runJS(source, { document: doc, domTree, eventLoop, globalEnv });
    eventLoop.drainMicrotasks();

    const source2 = `
      var db2 = openDatabase('persistdb', '1.0', 'P', 1024);
      var again = null;
      db2.transaction(function (tx) {
        tx.executeSql('SELECT a FROM t', [], function (tx, r) { again = r.rows.item(0); });
      });
    `;
    runJS(source2, { document: doc, domTree, eventLoop, globalEnv });
    eventLoop.drainMicrotasks();
    expect(plain(globalEnv.get('again'))).toEqual({ a: 'hello' });
  });
});
