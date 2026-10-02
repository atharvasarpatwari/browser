import { describe, it, expect, beforeEach } from 'vitest';
import {
  NovaDatabase,
  NovaSqlTransaction,
  InMemoryWebSQLBackend,
  SQLError,
  type SQLResultSet,
} from '../src/browser/storage/web-sql';

/**
 * Drains a transaction whose executeSql() calls have ALREADY been queued
 * (matching real usage: a page synchronously calls tx.executeSql() several
 * times inside the transaction callback, then the engine drains once).
 * Resolves with whether the transaction completed cleanly or hit an
 * unhandled error — never rejects, so callers don't need try/catch just to
 * assert on the error path.
 */
function drain(tx: NovaSqlTransaction): Promise<{ ok: true } | { ok: false; error: SQLError }> {
  return new Promise((resolve) => {
    tx.drain(() => resolve({ ok: true }), (error) => resolve({ ok: false, error }));
  });
}

describe('WebSQL', () => {
  let backend: InMemoryWebSQLBackend;
  let db: NovaDatabase;
  const origin = 'https://example.com';

  beforeEach(() => {
    backend = new InMemoryWebSQLBackend();
    db = new NovaDatabase(origin, 'testdb', '1.0', backend);
  });

  it('creates a table, inserts a row, and selects it back', async () => {
    const tx = db.createTransaction(false);
    const results: SQLResultSet[] = [];
    tx.executeSql('CREATE TABLE todo (id, text, done)');
    tx.executeSql('INSERT INTO todo (id, text, done) VALUES (?, ?, ?)', [1, 'buy milk', 0]);
    tx.executeSql('SELECT * FROM todo', [], (_t, r) => { results.push(r); });
    expect(await drain(tx)).toEqual({ ok: true });

    expect(results).toHaveLength(1);
    expect(results[0]!.rows.length).toBe(1);
    expect(results[0]!.rows.item(0)).toEqual({ id: 1, text: 'buy milk', done: 0 });
  });

  it('reports insertId and rowsAffected on INSERT', async () => {
    const tx = db.createTransaction(false);
    let insertResult: SQLResultSet | undefined;
    tx.executeSql('CREATE TABLE t (a)');
    tx.executeSql('INSERT INTO t (a) VALUES (?)', ['x'], (_t, r) => { insertResult = r; });
    expect(await drain(tx)).toEqual({ ok: true });
    expect(insertResult!.insertId).toBe(1);
    expect(insertResult!.rowsAffected).toBe(1);
  });

  it('filters rows with WHERE, including AND/OR/LIKE', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE people (name, age)');
    tx.executeSql('INSERT INTO people (name, age) VALUES (?, ?)', ['Alice', 30]);
    tx.executeSql('INSERT INTO people (name, age) VALUES (?, ?)', ['Bob', 25]);
    tx.executeSql('INSERT INTO people (name, age) VALUES (?, ?)', ['Carol', 40]);
    expect(await drain(tx)).toEqual({ ok: true });

    let overThirty: SQLResultSet | undefined;
    const tx2 = db.createTransaction(true);
    tx2.executeSql('SELECT name FROM people WHERE age >= ?', [30], (_t, r) => { overThirty = r; });
    expect(await drain(tx2)).toEqual({ ok: true });
    expect(overThirty!.rows.length).toBe(2);

    let aliceOrBob: SQLResultSet | undefined;
    const tx3 = db.createTransaction(true);
    tx3.executeSql('SELECT name FROM people WHERE name = ? OR name = ?', ['Alice', 'Bob'], (_t, r) => { aliceOrBob = r; });
    expect(await drain(tx3)).toEqual({ ok: true });
    expect(aliceOrBob!.rows.length).toBe(2);

    let likeMatch: SQLResultSet | undefined;
    const tx4 = db.createTransaction(true);
    tx4.executeSql('SELECT name FROM people WHERE name LIKE ?', ['A%'], (_t, r) => { likeMatch = r; });
    expect(await drain(tx4)).toEqual({ ok: true });
    expect(likeMatch!.rows.length).toBe(1);
    expect(likeMatch!.rows.item(0)).toEqual({ name: 'Alice' });
  });

  it('supports ORDER BY and LIMIT', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE n (v)');
    for (const v of [3, 1, 4, 1, 5]) tx.executeSql('INSERT INTO n (v) VALUES (?)', [v]);
    expect(await drain(tx)).toEqual({ ok: true });

    let sorted: SQLResultSet | undefined;
    const tx2 = db.createTransaction(true);
    tx2.executeSql('SELECT v FROM n ORDER BY v DESC LIMIT 2', [], (_t, r) => { sorted = r; });
    expect(await drain(tx2)).toEqual({ ok: true });
    expect(sorted!.rows.item(0)).toEqual({ v: 5 });
    expect(sorted!.rows.item(1)).toEqual({ v: 4 });
    expect(sorted!.rows.length).toBe(2);
  });

  it('SELECT supports column and table aliases with AS', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE t (a)');
    tx.executeSql('INSERT INTO t (a) VALUES (?)', ['hi']);
    let result: SQLResultSet | undefined;
    tx.executeSql('SELECT a AS renamed FROM t', [], (_t, r) => { result = r; });
    expect(await drain(tx)).toEqual({ ok: true });
    expect(result!.rows.item(0)).toEqual({ renamed: 'hi' });
  });

  describe('aggregate functions', () => {
    beforeEach(async () => {
      const tx = db.createTransaction(false);
      tx.executeSql('CREATE TABLE orders (amount)');
      tx.executeSql('INSERT INTO orders (amount) VALUES (?)', [10]);
      tx.executeSql('INSERT INTO orders (amount) VALUES (?)', [20]);
      tx.executeSql('INSERT INTO orders (amount) VALUES (?)', [null]);
      expect(await drain(tx)).toEqual({ ok: true });
    });

    it('COUNT(*) counts every row including ones with a null column', async () => {
      const tx = db.createTransaction(true);
      let result: SQLResultSet | undefined;
      tx.executeSql('SELECT COUNT(*) FROM orders', [], (_t, r) => { result = r; });
      expect(await drain(tx)).toEqual({ ok: true });
      expect(result!.rows.item(0)).toEqual({ 'COUNT(*)': 3 });
    });

    it('COUNT(col) only counts non-null values', async () => {
      const tx = db.createTransaction(true);
      let result: SQLResultSet | undefined;
      tx.executeSql('SELECT COUNT(amount) AS n FROM orders', [], (_t, r) => { result = r; });
      expect(await drain(tx)).toEqual({ ok: true });
      expect(result!.rows.item(0)).toEqual({ n: 2 });
    });

    it('SUM and AVG skip nulls and compute over the remaining values', async () => {
      const tx = db.createTransaction(true);
      let result: SQLResultSet | undefined;
      tx.executeSql('SELECT SUM(amount) AS total, AVG(amount) AS mean FROM orders', [], (_t, r) => { result = r; });
      expect(await drain(tx)).toEqual({ ok: true });
      expect(result!.rows.item(0)).toEqual({ total: 30, mean: 15 });
    });

    it('MIN and MAX ignore nulls', async () => {
      const tx = db.createTransaction(true);
      let result: SQLResultSet | undefined;
      tx.executeSql('SELECT MIN(amount) AS lo, MAX(amount) AS hi FROM orders', [], (_t, r) => { result = r; });
      expect(await drain(tx)).toEqual({ ok: true });
      expect(result!.rows.item(0)).toEqual({ lo: 10, hi: 20 });
    });

    it('SUM/AVG/MIN/MAX over zero matching rows are NULL, not 0', async () => {
      const tx = db.createTransaction(true);
      let result: SQLResultSet | undefined;
      tx.executeSql("SELECT SUM(amount) AS s, AVG(amount) AS a, MIN(amount) AS mn, MAX(amount) AS mx FROM orders WHERE amount > ?", [1000], (_t, r) => { result = r; });
      expect(await drain(tx)).toEqual({ ok: true });
      expect(result!.rows.item(0)).toEqual({ s: null, a: null, mn: null, mx: null });
    });

    it('respects WHERE before aggregating', async () => {
      const tx = db.createTransaction(true);
      let result: SQLResultSet | undefined;
      tx.executeSql('SELECT COUNT(*) AS n FROM orders WHERE amount >= ?', [15], (_t, r) => { result = r; });
      expect(await drain(tx)).toEqual({ ok: true });
      expect(result!.rows.item(0)).toEqual({ n: 1 });
    });

    it('rejects mixing an aggregate with a plain column (no GROUP BY support)', async () => {
      const tx = db.createTransaction(true);
      tx.executeSql('SELECT amount, COUNT(*) FROM orders');
      const outcome = await drain(tx);
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.error.code).toBe(SQLError.SYNTAX_ERR);
    });

    it('rejects SUM(*)/AVG(*)/MIN(*)/MAX(*) — only COUNT(*) is valid', async () => {
      const tx = db.createTransaction(true);
      tx.executeSql('SELECT SUM(*) FROM orders');
      const outcome = await drain(tx);
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.error.code).toBe(SQLError.SYNTAX_ERR);
    });
  });

  it('UPDATE changes matching rows and reports rowsAffected', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE t (a, b)');
    tx.executeSql('INSERT INTO t (a, b) VALUES (?, ?)', [1, 'x']);
    tx.executeSql('INSERT INTO t (a, b) VALUES (?, ?)', [2, 'x']);
    expect(await drain(tx)).toEqual({ ok: true });

    let updateResult: SQLResultSet | undefined;
    const tx2 = db.createTransaction(false);
    tx2.executeSql('UPDATE t SET b = ? WHERE a = ?', ['y', 1], (_t, r) => { updateResult = r; });
    expect(await drain(tx2)).toEqual({ ok: true });
    expect(updateResult!.rowsAffected).toBe(1);

    let check: SQLResultSet | undefined;
    const tx3 = db.createTransaction(true);
    tx3.executeSql('SELECT b FROM t WHERE a = ?', [1], (_t, r) => { check = r; });
    expect(await drain(tx3)).toEqual({ ok: true });
    expect(check!.rows.item(0)).toEqual({ b: 'y' });
  });

  it('DELETE removes only matching rows, or all rows with no WHERE', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE t (a)');
    tx.executeSql('INSERT INTO t (a) VALUES (?)', [1]);
    tx.executeSql('INSERT INTO t (a) VALUES (?)', [2]);
    tx.executeSql('INSERT INTO t (a) VALUES (?)', [3]);
    expect(await drain(tx)).toEqual({ ok: true });

    let del1: SQLResultSet | undefined;
    const tx2 = db.createTransaction(false);
    tx2.executeSql('DELETE FROM t WHERE a = ?', [2], (_t, r) => { del1 = r; });
    expect(await drain(tx2)).toEqual({ ok: true });
    expect(del1!.rowsAffected).toBe(1);

    let remaining: SQLResultSet | undefined;
    const tx3 = db.createTransaction(true);
    tx3.executeSql('SELECT a FROM t', [], (_t, r) => { remaining = r; });
    expect(await drain(tx3)).toEqual({ ok: true });
    expect(remaining!.rows.length).toBe(2);

    let delAll: SQLResultSet | undefined;
    const tx4 = db.createTransaction(false);
    tx4.executeSql('DELETE FROM t', [], (_t, r) => { delAll = r; });
    expect(await drain(tx4)).toEqual({ ok: true });
    expect(delAll!.rowsAffected).toBe(2);
  });

  it('DROP TABLE removes the table; IF EXISTS avoids the error', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE t (a)');
    tx.executeSql('DROP TABLE t');
    expect(await drain(tx)).toEqual({ ok: true });

    const tx2 = db.createTransaction(true);
    tx2.executeSql('SELECT * FROM t');
    const outcome = await drain(tx2);
    expect(outcome.ok).toBe(false);

    const tx3 = db.createTransaction(false);
    tx3.executeSql('DROP TABLE IF EXISTS t'); // does not error
    expect(await drain(tx3)).toEqual({ ok: true });
  });

  it('rejects mutating statements inside a read-only transaction', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE t (a)');
    expect(await drain(tx)).toEqual({ ok: true });

    const readTx = db.createTransaction(true);
    readTx.executeSql('INSERT INTO t (a) VALUES (?)', [1]);
    const outcome = await drain(readTx);
    expect(outcome.ok).toBe(false);
  });

  it('a real SQL syntax error surfaces as a SQLError with SYNTAX_ERR', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('SELEKT * FROM nowhere');
    const outcome = await drain(tx);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe(SQLError.SYNTAX_ERR);
  });

  it('an unhandled error stops the transaction, so later queued statements never run', async () => {
    const tx = db.createTransaction(false);
    const ran: string[] = [];
    tx.executeSql('CREATE TABLE t (a)', [], () => ran.push('create'));
    tx.executeSql('INSERT INTO nowhere (a) VALUES (?)', [1], () => ran.push('bad-insert'));
    tx.executeSql('SELECT * FROM t', [], () => ran.push('select'));
    const outcome = await drain(tx);
    expect(outcome.ok).toBe(false);
    expect(ran).toEqual(['create']);
  });

  it('an unhandled error rolls back every earlier statement in the same transaction, not just the failing one', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE t (a)');
    tx.executeSql('INSERT INTO t (a) VALUES (?)', ['should be undone']);
    tx.executeSql('INSERT INTO nowhere (a) VALUES (?)', [1]); // unhandled — aborts + rolls back
    const outcome = await drain(tx);
    expect(outcome.ok).toBe(false);

    // The whole transaction rolled back — "t" never existed, as far as a
    // later transaction can tell.
    const tx2 = db.createTransaction(true);
    tx2.executeSql('SELECT * FROM t');
    const check = await drain(tx2);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.error.code).toBe(SQLError.DATABASE_ERR);
  });

  it('a rolled-back transaction is not written to the backend either', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE t (a)');
    expect(await drain(tx)).toEqual({ ok: true });

    const tx2 = db.createTransaction(false);
    tx2.executeSql('INSERT INTO t (a) VALUES (?)', ['committed']);
    tx2.executeSql('INSERT INTO nowhere (a) VALUES (?)', [1]); // aborts this transaction
    expect((await drain(tx2)).ok).toBe(false);

    // Reopen from the backend — the aborted INSERT must not have persisted.
    const reopened = new NovaDatabase(origin, 'testdb', '1.0', backend);
    let rowCount = -1;
    const tx3 = reopened.createTransaction(true);
    tx3.executeSql('SELECT * FROM t', [], (_t, r) => { rowCount = r.rows.length; });
    expect(await drain(tx3)).toEqual({ ok: true });
    expect(rowCount).toBe(0);
  });

  it('an error callback returning true lets the transaction continue', async () => {
    const tx = db.createTransaction(false);
    const ran: string[] = [];
    tx.executeSql('INSERT INTO nowhere (a) VALUES (?)', [1], undefined, () => { ran.push('handled-error'); return true; });
    tx.executeSql('CREATE TABLE t (a)', [], () => ran.push('create'));
    expect(await drain(tx)).toEqual({ ok: true });
    expect(ran).toEqual(['handled-error', 'create']);
  });

  it('persists across separate NovaDatabase instances sharing a backend', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE t (a)');
    tx.executeSql('INSERT INTO t (a) VALUES (?)', ['persisted']);
    expect(await drain(tx)).toEqual({ ok: true });

    const reopened = new NovaDatabase(origin, 'testdb', '1.0', backend);
    let result: SQLResultSet | undefined;
    const tx2 = reopened.createTransaction(true);
    tx2.executeSql('SELECT a FROM t', [], (_t, r) => { result = r; });
    expect(await drain(tx2)).toEqual({ ok: true });
    expect(result!.rows.item(0)).toEqual({ a: 'persisted' });
  });

  it('changeVersion enforces the expected old version', () => {
    expect(() => db.changeVersion('0.9', '2.0')).toThrow(SQLError);
    expect(db.version).toBe('1.0');
    db.changeVersion('1.0', '2.0');
    expect(db.version).toBe('2.0');
    db.changeVersion('', '3.0'); // empty oldVersion always allowed
    expect(db.version).toBe('3.0');
  });

  it('CREATE TABLE IF NOT EXISTS is a no-op the second time', async () => {
    const tx = db.createTransaction(false);
    tx.executeSql('CREATE TABLE IF NOT EXISTS t (a)');
    tx.executeSql('CREATE TABLE IF NOT EXISTS t (a)'); // does not error
    expect(await drain(tx)).toEqual({ ok: true });
  });
});
