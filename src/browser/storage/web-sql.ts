/**
 * @file src/browser/storage/web-sql.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Web SQL Database (deprecated W3C draft, still used by legacy pages —
 * https://www.w3.org/TR/webdatabase/). Nova implements a real, bounded SQL
 * subset rather than a full engine:
 *
 *   CREATE TABLE [IF NOT EXISTS] name (col, col, ...)
 *   DROP TABLE [IF EXISTS] name
 *   INSERT INTO name [(col, ...)] VALUES (val, ...)
 *   SELECT (* | col, ...) FROM name [WHERE cond] [ORDER BY col [ASC|DESC]] [LIMIT n]
 *   UPDATE name SET col = val [, col = val ...] [WHERE cond]
 *   DELETE FROM name [WHERE cond]
 *
 * WHERE supports AND/OR-combined comparisons (=, !=, <>, <, >, <=, >=, LIKE)
 * with optional parentheses. Values are `?` positional placeholders, string
 * literals, numeric literals, or NULL.
 *
 * ponytail: no JOINs, no subqueries, no aggregate functions, and no real
 * transactional rollback (each statement's effect persists as it runs) —
 * this covers the CRUD-shaped usage real legacy WebSQL pages actually have.
 * Upgrade to a real embedded engine (e.g. sql.js) if a page needs more.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { loadNodeBuiltin } from '../networking/node-builtins';

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type SqlValue = string | number | null;

export interface SQLResultSetRowList {
  readonly length: number;
  item(index: number): Record<string, SqlValue> | null;
}

export interface SQLResultSet {
  readonly insertId: number | undefined;
  readonly rowsAffected: number;
  readonly rows: SQLResultSetRowList;
}

/** Mirrors the old spec's SQLException/SQLError codes. */
export class SQLError extends Error {
  static readonly UNKNOWN_ERR = 0;
  static readonly DATABASE_ERR = 1;
  static readonly VERSION_ERR = 2;
  static readonly TOO_LARGE_ERR = 3;
  static readonly QUOTA_ERR = 4;
  static readonly SYNTAX_ERR = 5;
  static readonly CONSTRAINT_ERR = 6;
  static readonly TIMEOUT_ERR = 7;

  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'SQLError';
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE BACKEND (mirrors local-storage.ts / indexed-db.ts's pattern)
// ─────────────────────────────────────────────────────────────────────────────

interface SerializedTable {
  columns: string[];
  rows: Record<string, SqlValue>[];
  nextRowId: number;
}

interface SerializedDatabase {
  version: string;
  tables: Record<string, SerializedTable>;
}

export interface IWebSQLBackend {
  load(origin: string, name: string): SerializedDatabase | null;
  save(origin: string, name: string, db: SerializedDatabase): void;
}

export class InMemoryWebSQLBackend implements IWebSQLBackend {
  private readonly store = new Map<string, SerializedDatabase>();

  private key(origin: string, name: string): string {
    return `${origin}\u0000${name}`;
  }

  load(origin: string, name: string): SerializedDatabase | null {
    const found = this.store.get(this.key(origin, name));
    return found ? structuredCloneLike(found) : null;
  }

  save(origin: string, name: string, db: SerializedDatabase): void {
    this.store.set(this.key(origin, name), structuredCloneLike(db));
  }
}

export class DiskWebSQLBackend implements IWebSQLBackend {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  load(origin: string, name: string): SerializedDatabase | null {
    try {
      const fs = loadNodeBuiltin<typeof import('node:fs')>('node:fs');
      const path = loadNodeBuiltin<typeof import('node:path')>('node:path');
      const filePath = path!.join(this.basePath, `websql-${this.sanitize(origin)}-${this.sanitize(name)}.json`);
      if (!fs!.existsSync(filePath)) return null;
      return JSON.parse(fs!.readFileSync(filePath, 'utf-8')) as SerializedDatabase;
    } catch {
      return null;
    }
  }

  save(origin: string, name: string, db: SerializedDatabase): void {
    try {
      const fs = loadNodeBuiltin<typeof import('node:fs')>('node:fs');
      const path = loadNodeBuiltin<typeof import('node:path')>('node:path');
      if (!fs!.existsSync(this.basePath)) fs!.mkdirSync(this.basePath, { recursive: true });
      const filePath = path!.join(this.basePath, `websql-${this.sanitize(origin)}-${this.sanitize(name)}.json`);
      fs!.writeFileSync(filePath, JSON.stringify(db), 'utf-8');
    } catch {
      // Silent — matches local-storage.ts/indexed-db.ts's disk-backend behavior.
    }
  }

  private sanitize(part: string): string {
    return part.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  }
}

function structuredCloneLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────

type TokenType = 'ident' | 'number' | 'string' | 'qmark' | 'punct' | 'eof';
interface Token { type: TokenType; value: string }

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '?') { tokens.push({ type: 'qmark', value: '?' }); i++; continue; }
    if (ch === "'") {
      let j = i + 1;
      let out = '';
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { out += "'"; j += 2; continue; }
          break;
        }
        out += sql[j]; j++;
      }
      tokens.push({ type: 'string', value: out });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(sql[j]!)) j++;
      tokens.push({ type: 'number', value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j]!)) j++;
      tokens.push({ type: 'ident', value: sql.slice(i, j) });
      i = j;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (two === '!=' || two === '<>' || two === '<=' || two === '>=') {
      tokens.push({ type: 'punct', value: two });
      i += 2;
      continue;
    }
    if ('(),=<>*.'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch });
      i++;
      continue;
    }
    throw new SQLError(SQLError.SYNTAX_ERR, `Unexpected character '${ch}' in SQL statement`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// AST
// ─────────────────────────────────────────────────────────────────────────────

type ValueExpr = { kind: 'qmark'; index: number } | { kind: 'literal'; value: SqlValue };
type Cond =
  | { kind: 'and'; left: Cond; right: Cond }
  | { kind: 'or'; left: Cond; right: Cond }
  | { kind: 'cmp'; column: string; op: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE'; value: ValueExpr };

type Stmt =
  | { kind: 'createTable'; ifNotExists: boolean; table: string; columns: string[] }
  | { kind: 'dropTable'; ifExists: boolean; table: string }
  | { kind: 'insert'; table: string; columns: string[] | null; values: ValueExpr[] }
  | { kind: 'select'; table: string; columns: '*' | string[]; where: Cond | null; orderBy: { column: string; dir: 'ASC' | 'DESC' } | null; limit: number | null }
  | { kind: 'update'; table: string; sets: { column: string; value: ValueExpr }[]; where: Cond | null }
  | { kind: 'delete'; table: string; where: Cond | null };

// ─────────────────────────────────────────────────────────────────────────────
// PARSER (recursive descent over the bounded grammar above)
// ─────────────────────────────────────────────────────────────────────────────

class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private qmarkCount = 0;

  constructor(sql: string) {
    this.tokens = tokenize(sql);
  }

  private peek(): Token { return this.tokens[this.pos]!; }
  private advance(): Token { return this.tokens[this.pos++]!; }

  private expectPunct(value: string): void {
    const tok = this.advance();
    if (tok.type !== 'punct' || tok.value !== value) {
      throw new SQLError(SQLError.SYNTAX_ERR, `Expected '${value}' but found '${tok.value || 'end of statement'}'`);
    }
  }

  private expectIdent(): string {
    const tok = this.advance();
    if (tok.type !== 'ident') {
      throw new SQLError(SQLError.SYNTAX_ERR, `Expected an identifier but found '${tok.value || 'end of statement'}'`);
    }
    return tok.value;
  }

  /** Case-insensitive keyword check without consuming on mismatch. */
  private matchKeyword(keyword: string): boolean {
    const tok = this.peek();
    if (tok.type === 'ident' && tok.value.toUpperCase() === keyword) {
      this.pos++;
      return true;
    }
    return false;
  }

  private requireKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      const tok = this.peek();
      throw new SQLError(SQLError.SYNTAX_ERR, `Expected '${keyword}' but found '${tok.value || 'end of statement'}'`);
    }
  }

  parse(): Stmt {
    if (this.matchKeyword('CREATE')) return this.parseCreateTable();
    if (this.matchKeyword('DROP')) return this.parseDropTable();
    if (this.matchKeyword('INSERT')) return this.parseInsert();
    if (this.matchKeyword('SELECT')) return this.parseSelect();
    if (this.matchKeyword('UPDATE')) return this.parseUpdate();
    if (this.matchKeyword('DELETE')) return this.parseDelete();
    throw new SQLError(SQLError.SYNTAX_ERR, `Unrecognized SQL statement: "${this.tokens.map(t => t.value).join(' ').trim()}"`);
  }

  private parseCreateTable(): Stmt {
    this.requireKeyword('TABLE');
    let ifNotExists = false;
    if (this.matchKeyword('IF')) {
      this.requireKeyword('NOT');
      this.requireKeyword('EXISTS');
      ifNotExists = true;
    }
    const table = this.expectIdent();
    this.expectPunct('(');
    const columns: string[] = [];
    while (true) {
      columns.push(this.expectIdent());
      // Ignore any type affinity / constraint keywords that follow a column
      // name up to the next comma or closing paren (e.g. "id INTEGER PRIMARY
      // KEY", "name TEXT NOT NULL") — Nova's tables are untyped like SQLite's.
      while (this.peek().type === 'ident') this.advance();
      const tok = this.advance();
      if (tok.type === 'punct' && tok.value === ')') break;
      if (!(tok.type === 'punct' && tok.value === ',')) {
        throw new SQLError(SQLError.SYNTAX_ERR, `Expected ',' or ')' in column list, found '${tok.value}'`);
      }
    }
    return { kind: 'createTable', ifNotExists, table, columns };
  }

  private parseDropTable(): Stmt {
    this.requireKeyword('TABLE');
    let ifExists = false;
    if (this.matchKeyword('IF')) {
      this.requireKeyword('EXISTS');
      ifExists = true;
    }
    const table = this.expectIdent();
    return { kind: 'dropTable', ifExists, table };
  }

  private parseInsert(): Stmt {
    this.requireKeyword('INTO');
    const table = this.expectIdent();
    let columns: string[] | null = null;
    if (this.peek().type === 'punct' && this.peek().value === '(') {
      this.advance();
      columns = [];
      while (true) {
        columns.push(this.expectIdent());
        const tok = this.advance();
        if (tok.type === 'punct' && tok.value === ')') break;
        if (!(tok.type === 'punct' && tok.value === ',')) {
          throw new SQLError(SQLError.SYNTAX_ERR, `Expected ',' or ')' in column list`);
        }
      }
    }
    this.requireKeyword('VALUES');
    this.expectPunct('(');
    const values: ValueExpr[] = [];
    while (true) {
      values.push(this.parseValue());
      const tok = this.advance();
      if (tok.type === 'punct' && tok.value === ')') break;
      if (!(tok.type === 'punct' && tok.value === ',')) {
        throw new SQLError(SQLError.SYNTAX_ERR, `Expected ',' or ')' in VALUES list`);
      }
    }
    return { kind: 'insert', table, columns, values };
  }

  private parseSelect(): Stmt {
    let columns: '*' | string[];
    if (this.peek().type === 'punct' && this.peek().value === '*') {
      this.advance();
      columns = '*';
    } else {
      const cols: string[] = [];
      while (true) {
        cols.push(this.expectIdent());
        if (this.peek().type === 'punct' && this.peek().value === ',') { this.advance(); continue; }
        break;
      }
      columns = cols;
    }
    this.requireKeyword('FROM');
    const table = this.expectIdent();
    const where = this.matchKeyword('WHERE') ? this.parseOrCond() : null;
    let orderBy: { column: string; dir: 'ASC' | 'DESC' } | null = null;
    if (this.matchKeyword('ORDER')) {
      this.requireKeyword('BY');
      const column = this.expectIdent();
      let dir: 'ASC' | 'DESC' = 'ASC';
      if (this.matchKeyword('DESC')) dir = 'DESC';
      else if (this.matchKeyword('ASC')) dir = 'ASC';
      orderBy = { column, dir };
    }
    let limit: number | null = null;
    if (this.matchKeyword('LIMIT')) {
      const tok = this.advance();
      if (tok.type !== 'number') throw new SQLError(SQLError.SYNTAX_ERR, 'LIMIT requires a number');
      limit = parseInt(tok.value, 10);
    }
    return { kind: 'select', table, columns, where, orderBy, limit };
  }

  private parseUpdate(): Stmt {
    const table = this.expectIdent();
    this.requireKeyword('SET');
    const sets: { column: string; value: ValueExpr }[] = [];
    while (true) {
      const column = this.expectIdent();
      this.expectPunct('=');
      const value = this.parseValue();
      sets.push({ column, value });
      if (this.peek().type === 'punct' && this.peek().value === ',') { this.advance(); continue; }
      break;
    }
    const where = this.matchKeyword('WHERE') ? this.parseOrCond() : null;
    return { kind: 'update', table, sets, where };
  }

  private parseDelete(): Stmt {
    this.requireKeyword('FROM');
    const table = this.expectIdent();
    const where = this.matchKeyword('WHERE') ? this.parseOrCond() : null;
    return { kind: 'delete', table, where };
  }

  private parseOrCond(): Cond {
    let left = this.parseAndCond();
    while (this.matchKeyword('OR')) {
      left = { kind: 'or', left, right: this.parseAndCond() };
    }
    return left;
  }

  private parseAndCond(): Cond {
    let left = this.parseCondAtom();
    while (this.matchKeyword('AND')) {
      left = { kind: 'and', left, right: this.parseCondAtom() };
    }
    return left;
  }

  private parseCondAtom(): Cond {
    if (this.peek().type === 'punct' && this.peek().value === '(') {
      this.advance();
      const inner = this.parseOrCond();
      this.expectPunct(')');
      return inner;
    }
    const column = this.expectIdent();
    const tok = this.advance();
    let cmpOp: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE';
    if (tok.type === 'punct' && (tok.value === '=' || tok.value === '!=' || tok.value === '<>' || tok.value === '<' || tok.value === '>' || tok.value === '<=' || tok.value === '>=')) {
      cmpOp = tok.value === '<>' ? '!=' : (tok.value as '=' | '!=' | '<' | '>' | '<=' | '>=');
    } else if (tok.type === 'ident' && tok.value.toUpperCase() === 'LIKE') {
      cmpOp = 'LIKE';
    } else {
      throw new SQLError(SQLError.SYNTAX_ERR, `Expected a comparison operator after '${column}', found '${tok.value}'`);
    }
    const value = this.parseValue();
    return { kind: 'cmp', column, op: cmpOp, value };
  }

  private parseValue(): ValueExpr {
    const tok = this.advance();
    if (tok.type === 'qmark') return { kind: 'qmark', index: this.qmarkCount++ };
    if (tok.type === 'string') return { kind: 'literal', value: tok.value };
    if (tok.type === 'number') return { kind: 'literal', value: tok.value.includes('.') ? parseFloat(tok.value) : parseInt(tok.value, 10) };
    if (tok.type === 'ident' && tok.value.toUpperCase() === 'NULL') return { kind: 'literal', value: null };
    // A bare unary minus before a number literal.
    if (tok.type === 'punct' && tok.value === '-' && this.peek().type === 'number') {
      const numTok = this.advance();
      const n = numTok.value.includes('.') ? parseFloat(numTok.value) : parseInt(numTok.value, 10);
      return { kind: 'literal', value: -n };
    }
    throw new SQLError(SQLError.SYNTAX_ERR, `Expected a value, found '${tok.value || 'end of statement'}'`);
  }
}

function parseSql(sql: string): Stmt {
  return new Parser(sql).parse();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

interface SqlTable {
  columns: string[];
  rows: (Record<string, SqlValue> & { __rowid: number })[];
  nextRowId: number;
}

function bindValue(expr: ValueExpr, args: readonly SqlValue[]): SqlValue {
  if (expr.kind === 'literal') return expr.value;
  if (expr.index >= args.length) {
    throw new SQLError(SQLError.SYNTAX_ERR, `Statement has more '?' placeholders than bound arguments`);
  }
  return args[expr.index]!;
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function evalCond(cond: Cond, row: Record<string, SqlValue>, args: readonly SqlValue[]): boolean {
  if (cond.kind === 'and') return evalCond(cond.left, row, args) && evalCond(cond.right, row, args);
  if (cond.kind === 'or') return evalCond(cond.left, row, args) || evalCond(cond.right, row, args);
  const rowValue = row[cond.column];
  if (!(cond.column in row)) {
    throw new SQLError(SQLError.SYNTAX_ERR, `No such column: ${cond.column}`);
  }
  const target = bindValue(cond.value, args);
  switch (cond.op) {
    case '=': return rowValue === target;
    case '!=': return rowValue !== target;
    case '<': return rowValue !== null && target !== null && rowValue < target;
    case '>': return rowValue !== null && target !== null && rowValue > target;
    case '<=': return rowValue !== null && target !== null && rowValue <= target;
    case '>=': return rowValue !== null && target !== null && rowValue >= target;
    case 'LIKE': return typeof rowValue === 'string' && typeof target === 'string' && likeToRegExp(target).test(rowValue);
  }
}

function requireTable(tables: Map<string, SqlTable>, name: string): SqlTable {
  const table = tables.get(name);
  if (!table) throw new SQLError(SQLError.DATABASE_ERR, `no such table: ${name}`);
  return table;
}

function executeStmt(tables: Map<string, SqlTable>, stmt: Stmt, args: readonly SqlValue[]): SQLResultSet {
  switch (stmt.kind) {
    case 'createTable': {
      if (tables.has(stmt.table)) {
        if (stmt.ifNotExists) return emptyResult();
        throw new SQLError(SQLError.DATABASE_ERR, `table ${stmt.table} already exists`);
      }
      tables.set(stmt.table, { columns: stmt.columns, rows: [], nextRowId: 1 });
      return emptyResult();
    }
    case 'dropTable': {
      if (!tables.has(stmt.table)) {
        if (stmt.ifExists) return emptyResult();
        throw new SQLError(SQLError.DATABASE_ERR, `no such table: ${stmt.table}`);
      }
      tables.delete(stmt.table);
      return emptyResult();
    }
    case 'insert': {
      const table = requireTable(tables, stmt.table);
      const columns = stmt.columns ?? table.columns;
      if (columns.length !== stmt.values.length) {
        throw new SQLError(SQLError.SYNTAX_ERR, `${stmt.values.length} values for ${columns.length} columns`);
      }
      for (const col of columns) {
        if (!table.columns.includes(col)) {
          throw new SQLError(SQLError.SYNTAX_ERR, `table ${stmt.table} has no column named ${col}`);
        }
      }
      const row: Record<string, SqlValue> & { __rowid: number } = { __rowid: table.nextRowId++ };
      for (const col of table.columns) row[col] = null;
      columns.forEach((col, i) => { row[col] = bindValue(stmt.values[i]!, args); });
      table.rows.push(row);
      return { insertId: row.__rowid, rowsAffected: 1, rows: wrapRows([]) };
    }
    case 'select': {
      const table = requireTable(tables, stmt.table);
      if (stmt.columns !== '*') {
        for (const col of stmt.columns) {
          if (!table.columns.includes(col)) {
            throw new SQLError(SQLError.SYNTAX_ERR, `no such column: ${col}`);
          }
        }
      }
      let matched = table.rows.filter(r => !stmt.where || evalCond(stmt.where, r, args));
      if (stmt.orderBy) {
        const { column, dir } = stmt.orderBy;
        if (!table.columns.includes(column)) throw new SQLError(SQLError.SYNTAX_ERR, `no such column: ${column}`);
        matched = [...matched].sort((a, b) => {
          const av = a[column]; const bv = b[column];
          const cmp = av === bv ? 0 : (av === null ? -1 : bv === null ? 1 : av < bv ? -1 : 1);
          return dir === 'ASC' ? cmp : -cmp;
        });
      }
      if (stmt.limit !== null) matched = matched.slice(0, stmt.limit);
      const projected = matched.map(r => {
        const cols = stmt.columns === '*' ? table.columns : stmt.columns;
        const out: Record<string, SqlValue> = {};
        for (const col of cols) out[col] = r[col] ?? null;
        return out;
      });
      return { insertId: undefined, rowsAffected: 0, rows: wrapRows(projected) };
    }
    case 'update': {
      const table = requireTable(tables, stmt.table);
      for (const set of stmt.sets) {
        if (!table.columns.includes(set.column)) {
          throw new SQLError(SQLError.SYNTAX_ERR, `no such column: ${set.column}`);
        }
      }
      let count = 0;
      for (const row of table.rows) {
        if (stmt.where && !evalCond(stmt.where, row, args)) continue;
        for (const set of stmt.sets) row[set.column] = bindValue(set.value, args);
        count++;
      }
      return { insertId: undefined, rowsAffected: count, rows: wrapRows([]) };
    }
    case 'delete': {
      const table = requireTable(tables, stmt.table);
      const before = table.rows.length;
      // Keep rows that do NOT match the WHERE clause (or keep none at all
      // when there's no WHERE, i.e. "DELETE FROM table" clears the table).
      table.rows = table.rows.filter(r => (stmt.where ? !evalCond(stmt.where, r, args) : false));
      return { insertId: undefined, rowsAffected: before - table.rows.length, rows: wrapRows([]) };
    }
  }
}

function wrapRows(rows: Record<string, SqlValue>[]): SQLResultSetRowList {
  return {
    length: rows.length,
    item(index: number): Record<string, SqlValue> | null {
      return rows[index] ?? null;
    },
  };
}

function emptyResult(): SQLResultSet {
  return { insertId: undefined, rowsAffected: 0, rows: wrapRows([]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE / TRANSACTION
// ─────────────────────────────────────────────────────────────────────────────

export class NovaDatabase {
  version: string;
  private readonly origin: string;
  private readonly name: string;
  private readonly backend: IWebSQLBackend;
  private readonly tables: Map<string, SqlTable>;

  constructor(origin: string, name: string, version: string, backend: IWebSQLBackend) {
    this.origin = origin;
    this.name = name;
    this.backend = backend;
    const saved = backend.load(origin, name);
    if (saved) {
      this.version = saved.version;
      this.tables = new Map(Object.entries(saved.tables).map(([tableName, t]) => [
        tableName,
        { columns: t.columns, rows: t.rows.map(r => ({ ...r, __rowid: (r as { __rowid?: number }).__rowid ?? 0 })), nextRowId: t.nextRowId },
      ]));
    } else {
      this.version = version;
      this.tables = new Map();
      this.persist();
    }
  }

  changeVersion(oldVersion: string, newVersion: string): void {
    if (oldVersion !== '' && oldVersion !== this.version) {
      throw new SQLError(SQLError.VERSION_ERR, `current version of the database and 'oldVersion' argument do not match`);
    }
    this.version = newVersion;
    this.persist();
  }

  createTransaction(readOnly: boolean): NovaSqlTransaction {
    return new NovaSqlTransaction(this, readOnly);
  }

  /** @internal used by NovaSqlTransaction */
  runStatement(sql: string, args: readonly SqlValue[], readOnly: boolean): SQLResultSet {
    const stmt = parseSql(sql);
    if (readOnly && stmt.kind !== 'select') {
      throw new SQLError(SQLError.UNKNOWN_ERR, 'could not prepare statement — read-only transaction');
    }
    const result = executeStmt(this.tables, stmt, args);
    if (stmt.kind !== 'select') this.persist();
    return result;
  }

  private persist(): void {
    const tables: Record<string, SerializedTable> = {};
    for (const [tableName, t] of this.tables) {
      tables[tableName] = { columns: t.columns, rows: t.rows.map(r => ({ ...r })), nextRowId: t.nextRowId };
    }
    this.backend.save(this.origin, this.name, { version: this.version, tables });
  }
}

interface QueuedStatement {
  sql: string;
  args: SqlValue[];
  onSuccess?: (tx: NovaSqlTransaction, result: SQLResultSet) => void;
  /** Returning `true` continues the transaction past this error (matches the
   *  spec's "return false to roll back" — inverted here: true = keep going). */
  onError?: (tx: NovaSqlTransaction, error: SQLError) => boolean | void;
}

export class NovaSqlTransaction {
  private readonly db: NovaDatabase;
  private readonly readOnly: boolean;
  private readonly queue: QueuedStatement[] = [];

  constructor(db: NovaDatabase, readOnly: boolean) {
    this.db = db;
    this.readOnly = readOnly;
  }

  executeSql(
    sql: string,
    args: SqlValue[] = [],
    onSuccess?: (tx: NovaSqlTransaction, result: SQLResultSet) => void,
    onError?: (tx: NovaSqlTransaction, error: SQLError) => boolean | void,
  ): void {
    this.queue.push({ sql, args, onSuccess, onError });
  }

  /**
   * Drain the queued statements one at a time; a success/error callback may
   * itself call executeSql() again, appending to the same queue (chaining).
   * Stops on the first unhandled error (onError not returning true).
   */
  drain(onComplete: () => void, onTransactionError: (error: SQLError) => void): void {
    const step = (): void => {
      const job = this.queue.shift();
      if (!job) { onComplete(); return; }
      try {
        const result = this.db.runStatement(job.sql, job.args, this.readOnly);
        job.onSuccess?.(this, result);
      } catch (err) {
        const sqlError = err instanceof SQLError ? err : new SQLError(SQLError.UNKNOWN_ERR, err instanceof Error ? err.message : String(err));
        const shouldContinue = job.onError?.(this, sqlError);
        if (shouldContinue !== true) {
          onTransactionError(sqlError);
          return;
        }
      }
      step();
    };
    step();
  }
}
