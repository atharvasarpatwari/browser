import type * as AST from './ast';
import {
  Environment,
  type JSValue, type JSObject, type JSFunction, type NativeFunction,
  toBoolean, toNumber, toString, getType, instanceofCheck,
  createObject, createArray, createFunction, createNativeFunction,
  isBreakSignal, isContinueSignal, isReturnSignal, isThrowSignal,
  type BreakSignal, type ContinueSignal, type ReturnSignal, type ThrowSignal,
  setGlobalCaller,
} from './values';

// ─────────────────────────────────────────────────────────────────────────────
// INTERPRETER — Tree-walking evaluator
// ─────────────────────────────────────────────────────────────────────────────

export class Interpreter {
  private globalEnv: Environment;
  private output: string[] = [];
  /** Pending microtasks / setTimeout callbacks */
  private taskQueue: Array<{ fn: () => void; delay: number }> = [];

  constructor(globalEnv?: Environment) {
    this.globalEnv = globalEnv ?? this.createGlobalEnv();
  }

  run(program: AST.Program): JSValue {
    setGlobalCaller(this);
    try {
      const result = this.execBlock(program.body, this.globalEnv);
      if (isThrowSignal(result)) throw new JSError(result.value);
      return result;
    } finally {
      setGlobalCaller(null);
    }
  }

  /** Called by callJSFunction in values.ts when non-native JS functions need invocation. */
  callFunction(fn: JSFunction, thisArg: JSValue, args: JSValue[]): JSValue {
    if (fn.isNative && fn.nativeFn) {
      return fn.nativeFn(thisArg, args);
    }
    const callEnv = new Environment(fn.closure);
    callEnv.markFunctionScope();
    callEnv.setLocal('arguments', createArray(args));
    fn.params.forEach((p, i) => callEnv.setLocal(p, args[i]));
    callEnv.setLocal('this', thisArg);
    const bodyNode = fn.body as AST.BlockStatement | AST.Expression;
    let result: JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal;
    if (bodyNode.type === 'BlockStatement') {
      result = this.execBlock(bodyNode.body as AST.Statement[], callEnv);
    } else {
      result = this.evalExpr(bodyNode as AST.Expression, callEnv);
    }
    if (isReturnSignal(result)) return result.value;
    if (isThrowSignal(result)) throw new JSError(result.value);
    return undefined;
  }

  getOutput(): string[] {
    return [...this.output];
  }

  getTaskQueue(): Array<{ fn: () => void; delay: number }> {
    return [...this.taskQueue];
  }

  // ── Statement execution ──────────────────────────────────────────────────

  private exec(stmt: AST.Statement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    switch (stmt.type) {
      case 'BlockStatement': return this.execBlock(stmt.body, env);
      case 'ExpressionStatement': return this.evalExpr(stmt.expression, env);
      case 'VariableDeclaration': return this.execVarDecl(stmt, env);
      case 'FunctionDeclaration': return this.execFuncDecl(stmt, env);
      case 'ClassDeclaration': return this.execClassDecl(stmt, env);
      case 'ReturnStatement': return this.execReturn(stmt, env);
      case 'IfStatement': return this.execIf(stmt, env);
      case 'WhileStatement': return this.execWhile(stmt, env);
      case 'DoWhileStatement': return this.execDoWhile(stmt, env);
      case 'ForStatement': return this.execFor(stmt, env);
      case 'ForInStatement': return this.execForIn(stmt, env);
      case 'ForOfStatement': return this.execForOf(stmt, env);
      case 'SwitchStatement': return this.execSwitch(stmt, env);
      case 'TryStatement': return this.execTry(stmt, env);
      case 'ThrowStatement': return this.execThrow(stmt, env);
      case 'BreakStatement': return { type: 'break', label: stmt.label?.name } as BreakSignal;
      case 'ContinueStatement': return { type: 'continue', label: stmt.label?.name } as ContinueSignal;
      case 'EmptyStatement': return undefined;
      case 'DebuggerStatement': return undefined;
      default: return undefined;
    }
  }

  private execBlock(body: AST.Statement[], env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    for (const stmt of body) {
      if (stmt.type === 'FunctionDeclaration') this.execFuncDecl(stmt, env);
    }
    let lastResult: JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal = undefined;
    for (const stmt of body) {
      if (stmt.type === 'FunctionDeclaration') continue;
      lastResult = this.exec(stmt, env);
      if (lastResult !== undefined && (isBreakSignal(lastResult) || isContinueSignal(lastResult) || isReturnSignal(lastResult) || isThrowSignal(lastResult))) {
        return lastResult;
      }
    }
    return lastResult;
  }

  private execVarDecl(stmt: AST.VariableDeclaration, env: Environment): void {
    for (const decl of stmt.declarations) {
      const value = decl.init ? this.evalExpr(decl.init, env) : undefined;
      this.destructPattern(decl.id, value, env, stmt.kind);
    }
  }

  private destructPattern(pattern: AST.Identifier | AST.RestElement | AST.AssignmentPattern | AST.ArrayPattern | AST.ObjectPattern, value: JSValue, env: Environment, kind: 'var' | 'let' | 'const'): void {
    if (pattern.type === 'Identifier') {
      const name = pattern.name;
      if (kind === 'const' || kind === 'let') {
        env.setLocal(name, value, kind);
      } else {
        env.declare(name, value, 'var');
      }
    } else if (pattern.type === 'AssignmentPattern') {
      const val = value === undefined || value === null ? this.evalExpr(pattern.right, env) : value;
      this.destructPattern(pattern.left, val, env, kind);
    } else if (pattern.type === 'ArrayPattern') {
      const arr = value as JSObject;
      let idx = 0;
      for (const elem of pattern.elements) {
        if (elem === null) {
          idx++;
          continue;
        }
        if (elem.type === 'RestElement') {
          const restArr: JSValue[] = [];
          const len = Number(arr?.properties?.get('length')?.value ?? 0);
          for (let i = idx; i < len; i++) {
            restArr.push(arr?.properties?.get(String(i))?.value);
          }
          this.destructPattern(elem.argument, createArray(restArr), env, kind);
        } else {
          const elemVal = arr?.properties?.get(String(idx))?.value;
          this.destructPattern(elem, elemVal, env, kind);
          idx++;
        }
      }
    } else if (pattern.type === 'ObjectPattern') {
      const obj = typeof value === 'object' && value !== null ? value as JSObject : createObject(null);
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          const restObj = createObject(null);
          const seenKeys = new Set<string>();
          for (const p of pattern.properties) {
            if (p.type === 'Property' && p.key.type === 'Identifier') seenKeys.add(p.key.name);
          }
          if (obj.properties) {
            for (const [k, desc] of obj.properties) {
              if (!seenKeys.has(k)) restObj.properties.set(k, desc);
            }
          }
          this.destructPattern(prop.argument, restObj, env, kind);
        } else {
          const key = prop.key.type === 'Identifier' ? prop.key.name : String(this.evalExpr(prop.key, env));
          const propVal = obj?.properties?.get(key)?.value;
          this.destructPattern(prop.value as any, propVal, env, kind);
        }
      }
    }
  }

  private execFuncDecl(stmt: AST.FunctionDeclaration, env: Environment): void {
    const fn = createFunction(stmt.id.name, stmt.params.map(p => (p as AST.Identifier).name), stmt.body, env, stmt.async);
    env.declare(stmt.id.name, fn, 'var');
  }

  private execClassDecl(stmt: AST.ClassDeclaration, env: Environment): void {
    const className = stmt.id?.name ?? '';
    const classProto = createObject(null);

    const classObj: JSObject = {
      type: 'class',
      properties: new Map(),
      prototype: classProto,
      callable: true,
    };

    // Set up prototype with constructor
    classProto.properties.set('constructor', {
      value: { type: 'closure', name: className, params: [], body: { type: 'BlockStatement', body: [] }, closure: env, async: false, isArrow: false, isNative: false } as JSFunction,
      writable: true, enumerable: false, configurable: true,
    });

    // Handle inheritance
    if (stmt.superClass) {
      const superClass = this.evalExpr(stmt.superClass, env);
      if (typeof superClass === 'object' && superClass !== null) {
        const superProto = (superClass as JSObject).prototype;
        if (superProto) classProto.prototype = superProto;
        classObj.properties.set('super', { value: superClass, writable: false, enumerable: false, configurable: false });
      }
    }

    // Store methods from body
    let hasConstructor = false;
    if (stmt.body.type === 'ClassBody') {
      for (const method of stmt.body.body) {
        if (method.type === 'MethodDefinition') {
          const key = method.key.type === 'Identifier' ? method.key.name : String(method.key);
          const fn = createFunction(key, method.value.params.map(p => (p as AST.Identifier).name), method.value.body, env);
          if (key === 'constructor') {
            hasConstructor = true;
            classObj.properties.set('constructor', { value: fn, writable: true, enumerable: true, configurable: true });
            classProto.properties.set('constructor', { value: fn, writable: true, enumerable: false, configurable: true });
          } else if (method.static) {
            classObj.properties.set(key, { value: fn, writable: true, enumerable: true, configurable: true });
          } else {
            classProto.properties.set(key, { value: fn, writable: true, enumerable: true, configurable: true });
          }
        }
      }
    }

    // Generate default constructor for derived classes without one
    if (!hasConstructor && stmt.superClass) {
      const defaultCtor = createFunction(className, [], {
        type: 'BlockStatement',
        body: [{
          type: 'ExpressionStatement',
          expression: {
            type: 'CallExpression',
            callee: { type: 'Identifier', name: 'super' } as AST.Identifier,
            arguments: [{ type: 'SpreadElement', argument: { type: 'Identifier', name: 'arguments' } as AST.Identifier } as AST.SpreadElement] as AST.Expression[],
            optional: false,
          },
        }],
      } as unknown as AST.BlockStatement, env);
      classObj.properties.set('constructor', { value: defaultCtor, writable: true, enumerable: true, configurable: true });
      classProto.properties.set('constructor', { value: defaultCtor, writable: true, enumerable: false, configurable: true });
    }

    env.declare(className, classObj, 'var');
  }

  private execReturn(stmt: AST.ReturnStatement, env: Environment): ReturnSignal {
    const value = stmt.argument ? this.evalExpr(stmt.argument, env) : undefined;
    return { type: 'return', value };
  }

  private execIf(stmt: AST.IfStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    if (toBoolean(this.evalExpr(stmt.test, env))) {
      return this.exec(stmt.consequent, env);
    } else if (stmt.alternate) {
      return this.exec(stmt.alternate, env);
    }
    return undefined;
  }

  private execWhile(stmt: AST.WhileStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    while (toBoolean(this.evalExpr(stmt.test, env))) {
      const result = this.exec(stmt.body, env);
      if (isBreakSignal(result)) return undefined;
      if (isContinueSignal(result)) continue;
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    }
    return undefined;
  }

  private execDoWhile(stmt: AST.DoWhileStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    do {
      const result = this.exec(stmt.body, env);
      if (isBreakSignal(result)) return undefined;
      if (isContinueSignal(result)) continue;
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    } while (toBoolean(this.evalExpr(stmt.test, env)));
    return undefined;
  }

  private execFor(stmt: AST.ForStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const loopEnv = new Environment(env);
    if (stmt.init) {
      if (stmt.init.type === 'VariableDeclaration') {
        this.execVarDecl(stmt.init, loopEnv);
      } else {
        this.evalExpr(stmt.init, loopEnv);
      }
    }
    while (true) {
      if (stmt.test && !toBoolean(this.evalExpr(stmt.test, loopEnv))) break;
      const result = this.exec(stmt.body, loopEnv);
      if (isBreakSignal(result)) return undefined;
      if (isContinueSignal(result)) { /* fall through to update */ }
      else if (isReturnSignal(result) || isThrowSignal(result)) return result;
      if (stmt.update) this.evalExpr(stmt.update, loopEnv);
    }
    return undefined;
  }

  private execForIn(stmt: AST.ForInStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const obj = this.evalExpr(stmt.right, env);
    if (typeof obj !== 'object' || obj === null) return undefined;
    const keys = [...(obj as JSObject).properties.keys()];
    const loopEnv = new Environment(env);
    const varName = stmt.left.type === 'VariableDeclaration'
      ? (stmt.left.declarations[0]!.id as AST.Identifier).name
      : (stmt.left as AST.Identifier).name;
    if (stmt.left.type === 'VariableDeclaration') {
      loopEnv.declare(varName, undefined, stmt.left.kind as 'var' | 'let' | 'const');
    }
    for (const key of keys) {
      loopEnv.set(varName, key);
      const result = this.exec(stmt.body, loopEnv);
      if (isBreakSignal(result)) return undefined;
      if (isContinueSignal(result)) continue;
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    }
    return undefined;
  }

  private execForOf(stmt: AST.ForOfStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const iterable = this.evalExpr(stmt.right, env);
    if (typeof iterable !== 'object' || iterable === null) return undefined;
    const arr = iterable as JSObject;
    const length = Number(arr.properties.get('length')?.value ?? 0);
    const loopEnv = new Environment(env);
    const varName = stmt.left.type === 'VariableDeclaration'
      ? (stmt.left.declarations[0]!.id as AST.Identifier).name
      : (stmt.left as AST.Identifier).name;
    if (stmt.left.type === 'VariableDeclaration') {
      loopEnv.declare(varName, undefined, stmt.left.kind as 'var' | 'let' | 'const');
    }
    for (let i = 0; i < length; i++) {
      const val = arr.properties.get(String(i))?.value;
      loopEnv.set(varName, val);
      const result = this.exec(stmt.body, loopEnv);
      if (isBreakSignal(result)) return undefined;
      if (isContinueSignal(result)) continue;
      if (isReturnSignal(result) || isThrowSignal(result)) return result;
    }
    return undefined;
  }

  private execSwitch(stmt: AST.SwitchStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    const disc = this.evalExpr(stmt.discriminant, env);
    let matched = false;
    for (const c of stmt.cases) {
      if (!matched && c.test) {
        const caseVal = this.evalExpr(c.test, env);
        if (disc === caseVal || (typeof disc === 'number' && typeof caseVal === 'number' && Object.is(disc, caseVal))) {
          matched = true;
        } else if (disc === caseVal) {
          matched = true;
        }
      }
      if (matched || !c.test) {
        if (c.test) matched = true;
        for (const s of c.consequent) {
          const result = this.exec(s, env);
          if (isBreakSignal(result)) return undefined;
          if (isContinueSignal(result) || isReturnSignal(result) || isThrowSignal(result)) return result;
        }
      }
    }
    return undefined;
  }

  private execTry(stmt: AST.TryStatement, env: Environment): JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal {
    let pendingReturn: ReturnSignal | undefined;
    let pendingBreak: BreakSignal | undefined;
    let pendingContinue: ContinueSignal | undefined;
    let pendingThrow: ThrowSignal | undefined;

    try {
      const result = this.execBlock(stmt.block.body, env);
      if (isThrowSignal(result)) {
        if (stmt.handler) {
          const catchEnv = new Environment(env);
          if (stmt.handler.param) {
            catchEnv.setLocal(stmt.handler.param.name, result.value);
          }
          const catchResult = this.execBlock(stmt.handler.body.body, catchEnv);
          if (isThrowSignal(catchResult)) pendingThrow = catchResult;
          else if (isReturnSignal(catchResult)) pendingReturn = catchResult;
          else if (isBreakSignal(catchResult)) pendingBreak = catchResult;
          else if (isContinueSignal(catchResult)) pendingContinue = catchResult;
        } else {
          pendingThrow = result;
        }
      } else if (isReturnSignal(result)) {
        pendingReturn = result;
      } else if (isBreakSignal(result)) {
        pendingBreak = result;
      } else if (isContinueSignal(result)) {
        pendingContinue = result;
      }
    } catch (e) {
      if (e instanceof JSError && stmt.handler) {
        const catchEnv = new Environment(env);
        if (stmt.handler.param) {
          catchEnv.setLocal(stmt.handler.param.name, e.value);
        }
        const catchResult = this.execBlock(stmt.handler.body.body, catchEnv);
        if (isThrowSignal(catchResult)) pendingThrow = catchResult;
        else if (isReturnSignal(catchResult)) pendingReturn = catchResult;
        else if (isBreakSignal(catchResult)) pendingBreak = catchResult;
        else if (isContinueSignal(catchResult)) pendingContinue = catchResult;
      } else if (!(e instanceof JSError)) {
        throw e;
      } else if (!stmt.handler) {
        throw e;
      }
    }

    if (stmt.finalizer) {
      const finResult = this.execBlock(stmt.finalizer.body, env);
      if (isReturnSignal(finResult)) pendingReturn = finResult;
      else if (isBreakSignal(finResult)) pendingBreak = finResult;
      else if (isContinueSignal(finResult)) pendingContinue = finResult;
      else if (isThrowSignal(finResult)) pendingThrow = finResult;
    }

    if (pendingReturn) return pendingReturn;
    if (pendingThrow) return pendingThrow;
    if (pendingBreak) return pendingBreak;
    if (pendingContinue) return pendingContinue;
    return undefined;
  }

  private execThrow(stmt: AST.ThrowStatement, env: Environment): ThrowSignal {
    const value = this.evalExpr(stmt.argument, env);
    return { type: 'throw', value };
  }

  // ── Expression evaluation ────────────────────────────────────────────────

  private evalExpr(expr: AST.Expression, env: Environment): JSValue {
    switch (expr.type) {
      case 'Literal': return this.evalLiteral(expr);
      case 'Identifier': return this.evalIdentifier(expr, env);
      case 'ThisExpression': return env.get('this') ?? undefined;
      case 'SuperExpression': return env.get('super') ?? createObject(null);
      case 'UnaryExpression': return this.evalUnary(expr, env);
      case 'UpdateExpression': return this.evalUpdate(expr, env);
      case 'BinaryExpression': return this.evalBinary(expr, env);
      case 'LogicalExpression': return this.evalLogical(expr, env);
      case 'AssignmentExpression': return this.evalAssignment(expr, env);
      case 'ConditionalExpression': return this.evalConditional(expr, env);
      case 'CallExpression': return this.evalCall(expr, env);
      case 'NewExpression': return this.evalNew(expr, env);
      case 'MemberExpression': return this.evalMember(expr, env);
      case 'ArrayExpression': return this.evalArray(expr, env);
      case 'ObjectExpression': return this.evalObject(expr, env);
      case 'FunctionExpression': return this.evalFunctionExpr(expr, env);
      case 'ArrowFunctionExpression': return this.evalArrowFunction(expr, env);
      case 'SequenceExpression': return this.evalSequence(expr, env);
      default: return undefined;
    }
  }

  private evalLiteral(expr: AST.Literal): JSValue {
    if (expr.value && typeof expr.value === 'object' && 'type' in expr.value) {
      // RegExp literal
      return expr.raw;
    }
    return expr.value as JSValue;
  }

  private evalIdentifier(expr: AST.Identifier, env: Environment): JSValue {
    return env.get(expr.name);
  }

  private evalUnary(expr: AST.UnaryExpression, env: Environment): JSValue {
    if (expr.operator === 'typeof') {
      const val = this.evalExpr(expr.argument, env);
      return getType(val);
    }
    if (expr.operator === 'void') {
      this.evalExpr(expr.argument, env);
      return undefined;
    }
    if (expr.operator === 'delete') {
      // Simplified
      return true;
    }
    const val = this.evalExpr(expr.argument, env);
    switch (expr.operator) {
      case '-': return -toNumber(val);
      case '+': return toNumber(val);
      case '!': return !toBoolean(val);
      case '~': return ~toNumber(val);
      default: return val;
    }
  }

  private evalUpdate(expr: AST.UpdateExpression, env: Environment): JSValue {
    if (expr.argument.type === 'MemberExpression') {
      const obj = this.evalExpr(expr.argument.object, env) as JSObject;
      if (typeof obj !== 'object' || obj === null) return 0;
      const key = expr.argument.computed
        ? String(this.evalExpr(expr.argument.property, env))
        : (expr.argument.property as AST.Identifier).name;
      const old = toNumber(obj.properties.get(key)?.value);
      const newVal = expr.operator === '++' ? old + 1 : old - 1;
      obj.properties.set(key, { value: newVal, writable: true, enumerable: true, configurable: true });
      return expr.prefix ? newVal : old;
    }
    const name = (expr.argument as AST.Identifier)?.name;
    if (!name) return 0;
    const old = toNumber(env.get(name));
    const newVal = expr.operator === '++' ? old + 1 : old - 1;
    env.set(name, newVal);
    return expr.prefix ? newVal : old;
  }

  private evalBinary(expr: AST.BinaryExpression, env: Environment): JSValue {
    const left = this.evalExpr(expr.left, env);
    const right = this.evalExpr(expr.right, env);

    switch (expr.operator) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') return toString(left) + toString(right);
        return toNumber(left) + toNumber(right);
      case '-': return toNumber(left) - toNumber(right);
      case '*': return toNumber(left) * toNumber(right);
      case '/': return toNumber(left) / toNumber(right);
      case '%': return toNumber(left) % toNumber(right);
      case '**': return toNumber(left) ** toNumber(right);
      case '<': return left < right as unknown as boolean;
      case '>': return left > right as unknown as boolean;
      case '<=': return left <= right as unknown as boolean;
      case '>=': return left >= right as unknown as boolean;
      case '==': return left == right as unknown as boolean;
      case '!=': return left != right as unknown as boolean;
      case '===': return left === right;
      case '!==': return left !== right;
      case '&': return toNumber(left) & toNumber(right);
      case '|': return toNumber(left) | toNumber(right);
      case '^': return toNumber(left) ^ toNumber(right);
      case '<<': return toNumber(left) << toNumber(right);
      case '>>': return toNumber(left) >> toNumber(right);
      case '>>>': return toNumber(left) >>> toNumber(right);
      case 'instanceof': return instanceofCheck(left, right);
      case 'in': return typeof right === 'object' && right !== null
        ? (right as JSObject).properties.has(toString(left))
        : false;
      default: return undefined;
    }
  }

  private evalLogical(expr: AST.LogicalExpression, env: Environment): JSValue {
    const left = this.evalExpr(expr.left, env);
    if (expr.operator === '&&') {
      return toBoolean(left) ? this.evalExpr(expr.right, env) : left;
    }
    if (expr.operator === '||') {
      return toBoolean(left) ? left : this.evalExpr(expr.right, env);
    }
    if (expr.operator === '??') {
      return left !== null && left !== undefined ? left : this.evalExpr(expr.right, env);
    }
    return left;
  }

  private evalAssignment(expr: AST.AssignmentExpression, env: Environment): JSValue {
    const right = this.evalExpr(expr.right, env);

    if (expr.left.type === 'Identifier') {
      const name = expr.left.name;
      if (expr.operator === '=') {
        env.set(name, right);
        return right;
      }
      const current = env.get(name);
      let newVal: JSValue;
      switch (expr.operator) {
        case '+=': newVal = (typeof current === 'string' || typeof right === 'string') ? toString(current) + toString(right) : toNumber(current) + toNumber(right); break;
        case '-=': newVal = toNumber(current) - toNumber(right); break;
        case '*=': newVal = toNumber(current) * toNumber(right); break;
        case '/=': newVal = toNumber(current) / toNumber(right); break;
        case '%=': newVal = toNumber(current) % toNumber(right); break;
        case '&=': newVal = toNumber(current) & toNumber(right); break;
        case '|=': newVal = toNumber(current) | toNumber(right); break;
        case '^=': newVal = toNumber(current) ^ toNumber(right); break;
        case '<<=': newVal = toNumber(current) << toNumber(right); break;
        case '>>=': newVal = toNumber(current) >> toNumber(right); break;
        case '>>>=': newVal = toNumber(current) >>> toNumber(right); break;
        default: newVal = right;
      }
      env.set(name, newVal);
      return newVal;
    }

    if (expr.left.type === 'MemberExpression') {
      const obj = this.evalExpr(expr.left.object, env) as JSObject;
      if (typeof obj !== 'object' || obj === null) return right;
      const key = expr.left.computed
        ? String(this.evalExpr(expr.left.property, env))
        : (expr.left.property as AST.Identifier).name;
      if (expr.operator === '=') {
        obj.properties.set(key, { value: right, writable: true, enumerable: true, configurable: true });
        return right;
      }
      let current: JSValue;
      if (obj.properties.has(key)) {
        current = obj.properties.get(key)!.value;
      } else if (obj.prototype) {
        let proto: JSObject | null = obj.prototype;
        let found = false;
        while (proto) {
          if (proto.properties.has(key)) { current = proto.properties.get(key)!.value; found = true; break; }
          proto = proto.prototype;
        }
        if (!found) current = undefined;
      } else {
        current = undefined;
      }
      let newVal: JSValue;
      switch (expr.operator) {
        case '+=': newVal = (typeof current === 'string' || typeof right === 'string') ? toString(current) + toString(right) : toNumber(current) + toNumber(right); break;
        case '-=': newVal = toNumber(current) - toNumber(right); break;
        case '*=': newVal = toNumber(current) * toNumber(right); break;
        case '/=': newVal = toNumber(current) / toNumber(right); break;
        case '%=': newVal = toNumber(current) % toNumber(right); break;
        case '&=': newVal = toNumber(current) & toNumber(right); break;
        case '|=': newVal = toNumber(current) | toNumber(right); break;
        case '^=': newVal = toNumber(current) ^ toNumber(right); break;
        case '<<=': newVal = toNumber(current) << toNumber(right); break;
        case '>>=': newVal = toNumber(current) >> toNumber(right); break;
        case '>>>=': newVal = toNumber(current) >>> toNumber(right); break;
        default: newVal = right;
      }
      obj.properties.set(key, { value: newVal, writable: true, enumerable: true, configurable: true });
      return newVal;
    }

    return right;
  }

  private evalConditional(expr: AST.ConditionalExpression, env: Environment): JSValue {
    return toBoolean(this.evalExpr(expr.test, env))
      ? this.evalExpr(expr.consequent, env)
      : this.evalExpr(expr.alternate, env);
  }

  private evalCall(expr: AST.CallExpression, env: Environment): JSValue {
    const callee = this.evalExpr(expr.callee, env);
    const args: JSValue[] = [];
    for (const a of expr.arguments) {
      if (a.type === 'SpreadElement') {
        const spreadVal = this.evalExpr(a.argument, env);
        if (Array.isArray(spreadVal)) {
          args.push(...spreadVal);
        } else if (typeof spreadVal === 'object' && spreadVal !== null && 'type' in spreadVal && (spreadVal as any).type === 'array') {
          const arr = spreadVal as JSObject;
          const len = Number(arr.properties.get('length')?.value ?? 0);
          for (let i = 0; i < len; i++) {
            args.push(arr.properties.get(String(i))?.value);
          }
        } else {
          args.push(spreadVal);
        }
      } else {
        args.push(this.evalExpr(a, env));
      }
    }

    if (typeof callee === 'object' && callee !== null) {
      const fn = callee as JSFunction;
      if (fn.type === 'closure' && fn.isNative && fn.nativeFn) {
        const thisObj = expr.callee.type === 'MemberExpression'
          ? this.evalExpr(expr.callee.object, env)
          : this.globalEnv.get('this') ?? createObject(null);
        return fn.nativeFn(thisObj, args);
      }
      if (fn.type === 'closure' && !fn.isNative) {
        const callEnv = new Environment(fn.closure);
        callEnv.markFunctionScope();
        callEnv.setLocal('arguments', createArray(args));
        fn.params.forEach((p, i) => callEnv.setLocal(p, args[i]));
        if (fn.isArrow) {
          callEnv.setLocal('this', fn.closure.get('this') ?? createObject(null));
        } else if (expr.callee.type === 'MemberExpression') {
          callEnv.setLocal('this', this.evalExpr(expr.callee.object, env));
        } else {
          callEnv.setLocal('this', env.get('this') ?? createObject(null));
        }
        const bodyNode = fn.body as AST.BlockStatement | AST.Expression;
        let result: JSValue | BreakSignal | ContinueSignal | ReturnSignal | ThrowSignal;
        if (bodyNode.type === 'BlockStatement') {
          result = this.execBlock(bodyNode.body as AST.Statement[], callEnv);
        } else {
          result = this.evalExpr(bodyNode as AST.Expression, callEnv);
        }
        if (isReturnSignal(result)) return result.value;
        if (isThrowSignal(result)) throw new JSError(result.value);
        return result;
      }
      // Object-as-function
      const callFn = fn.properties.get('call')?.value;
      if (typeof callFn === 'object' && callFn !== null && (callFn as JSFunction).type === 'closure') {
        return this.evalCall({ type: 'CallExpression', callee: callFn as unknown as AST.Expression, arguments: [expr.callee, ...expr.arguments], optional: false }, env);
      }
    }

    if (typeof callee === 'function') {
      return (callee as Function)(...args) as JSValue;
    }

    return undefined;
  }

  private evalNew(expr: AST.NewExpression, env: Environment): JSValue {
    const ctor = this.evalExpr(expr.callee, env);
    const args = expr.arguments.map(a => this.evalExpr(a, env));

    // Class constructor (type: 'class' on a JSObject)
    if (typeof ctor === 'object' && ctor !== null && 'type' in ctor && (ctor as JSObject).type === 'class') {
      const classObj = ctor as JSObject;
      const classProto = classObj.prototype ?? createObject(null);
      const instance = createObject(classProto);

      const superClass = classObj.properties?.get('super')?.value;
      const initFn = classObj.properties?.get('constructor');

      if (initFn?.value && typeof initFn.value === 'object' && 'type' in initFn.value && (initFn.value as JSFunction).type === 'closure') {
        const fn = initFn.value as JSFunction;
        const callEnv = new Environment(fn.closure);
        callEnv.markFunctionScope();
        callEnv.setLocal('this', instance);
        callEnv.setLocal('arguments', createArray(args));

        if (superClass && typeof superClass === 'object' && superClass !== null) {
          const superFn = createNativeFunction('super', (_s, sArgs) => {
            const parentCtor = superClass as JSObject;
            const parentInit = parentCtor.properties?.get('constructor');
            if (parentInit?.value && typeof parentInit.value === 'object' && 'type' in parentInit.value && (parentInit.value as JSFunction).type === 'closure') {
              const pfn = parentInit.value as JSFunction;
              const pEnv = new Environment(pfn.closure);
              pEnv.markFunctionScope();
              pEnv.setLocal('this', instance);
              pEnv.setLocal('arguments', createArray(sArgs));
              pfn.params.forEach((p, i) => pEnv.setLocal(p, sArgs[i]));
              const pResult = this.execBlock((pfn.body as AST.BlockStatement).body as AST.Statement[], pEnv);
              if (isReturnSignal(pResult) && typeof pResult.value === 'object' && pResult.value !== null) {
                return pResult.value;
              }
            }
            return instance;
          });
          callEnv.setLocal('super', superFn);
        }

        fn.params.forEach((p, i) => callEnv.setLocal(p, args[i]));
        const result = this.execBlock((fn.body as AST.BlockStatement).body as AST.Statement[], callEnv);
        if (isReturnSignal(result) && typeof result.value === 'object' && result.value !== null) {
          return result.value;
        }
      }

      return instance;
    }

    // Function constructor (JSFunction closure)
    if (typeof ctor === 'object' && ctor !== null && 'type' in ctor && (ctor as JSFunction).type === 'closure') {
      const fn = ctor as JSFunction;
      const instance = createObject(null);
      const callEnv = new Environment(fn.closure);
      callEnv.markFunctionScope();
      callEnv.setLocal('this', instance);
      callEnv.setLocal('arguments', createArray(args));
      fn.params.forEach((p, i) => callEnv.setLocal(p, args[i]));
      const bodyNode = fn.body as AST.BlockStatement | AST.Expression;
      if (bodyNode.type === 'BlockStatement') {
        const result = this.execBlock(bodyNode.body as AST.Statement[], callEnv);
        if (isReturnSignal(result) && typeof result.value === 'object' && result.value !== null) {
          return result.value;
        }
      }
      return instance;
    }

    return createObject(null);
  }

  private evalMember(expr: AST.MemberExpression, env: Environment): JSValue {
    const obj = this.evalExpr(expr.object, env);
    if (obj === undefined || obj === null) {
      if (expr.optional) return undefined;
      throw new TypeError(`Cannot read properties of ${obj}`);
    }
    if (typeof obj === 'string') {
      const key = expr.computed ? String(this.evalExpr(expr.property, env)) : (expr.property as AST.Identifier).name;
      if (key === 'length') return (obj as string).length;
      const idx = parseInt(key, 10);
      if (!isNaN(idx)) return (obj as string)[idx] ?? undefined;
      const strMethods: Record<string, NativeFunction> = {
        toUpperCase: (_t, _a) => (obj as string).toUpperCase(),
        toLowerCase: (_t, _a) => (obj as string).toLowerCase(),
        charAt: (_t, a) => (obj as string).charAt(toNumber(a[0])),
        charCodeAt: (_t, a) => (obj as string).charCodeAt(toNumber(a[0])),
        indexOf: (_t, a) => (obj as string).indexOf(toString(a[0])),
        lastIndexOf: (_t, a) => (obj as string).lastIndexOf(toString(a[0])),
        slice: (_t, a) => (obj as string).slice(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        substring: (_t, a) => (obj as string).substring(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        substr: (_t, a) => (obj as string).substr(toNumber(a[0]), a[1] !== undefined ? toNumber(a[1]) : undefined),
        split: (_t, a) => {
          const sep = a[0] !== undefined ? toString(a[0]) : undefined;
          const parts = sep !== undefined ? (obj as string).split(sep) : [obj as string];
          return createArray(parts.map(p => p as unknown as JSValue));
        },
        replace: (_t, a) => (obj as string).replace(toString(a[0]), toString(a[1] ?? '')),
        trim: (_t, _a) => (obj as string).trim(),
        trimStart: (_t, _a) => (obj as string).trimStart(),
        trimEnd: (_t, _a) => (obj as string).trimEnd(),
        includes: (_t, a) => (obj as string).includes(toString(a[0])),
        startsWith: (_t, a) => (obj as string).startsWith(toString(a[0])),
        endsWith: (_t, a) => (obj as string).endsWith(toString(a[0])),
        repeat: (_t, a) => (obj as string).repeat(toNumber(a[0])),
        concat: (_t, a) => (obj as string).concat(a.map(toString).join('')),
        padStart: (_t, a) => (obj as string).padStart(toNumber(a[0]), toString(a[1] ?? ' ')),
        padEnd: (_t, a) => (obj as string).padEnd(toNumber(a[0]), toString(a[1] ?? ' ')),
        match: (_t, a) => {
          const m = (obj as string).match(new RegExp(toString(a[0])));
          return m ? createArray(m.map(v => v as unknown as JSValue)) : null;
        },
        search: (_t, a) => (obj as string).search(new RegExp(toString(a[0]))),
        valueOf: (_t, _a) => obj,
        toString: (_t, _a) => obj,
      };
      if (key in strMethods) {
        return createNativeFunction(key, strMethods[key]);
      }
      return undefined;
    }
    const nativeObj = obj as JSObject;
    const key = expr.computed
      ? String(this.evalExpr(expr.property, env))
      : (expr.property as AST.Identifier).name;
    const desc = nativeObj.properties.get(key);
    if (desc) return desc.value;
    if (nativeObj.prototype) {
      let proto: JSObject | null = nativeObj.prototype;
      while (proto) {
        const protoDesc = proto.properties.get(key);
        if (protoDesc) return protoDesc.value;
        proto = proto.prototype;
      }
    }
    return undefined;
  }

  private evalArray(expr: AST.ArrayExpression, env: Environment): JSValue {
    const elements = expr.elements.map(e => {
      if (!e) return undefined;
      if (e.type === 'SpreadElement') return this.evalExpr(e.argument, env);
      return this.evalExpr(e, env);
    });
    return createArray(elements);
  }

  private evalObject(expr: AST.ObjectExpression, env: Environment): JSValue {
    const obj = createObject(null);
    for (const prop of expr.properties) {
      if (prop.type === 'SpreadElement') {
        const spread = this.evalExpr(prop.argument, env);
        if (typeof spread === 'object' && spread !== null) {
          for (const [k, v] of (spread as JSObject).properties) {
            obj.properties.set(k, v);
          }
        }
        continue;
      }
      const key = prop.computed
        ? String(this.evalExpr(prop.key, env))
        : prop.key.type === 'Identifier' ? prop.key.name : String(prop.key);
      const value = prop.value ? this.evalExpr(prop.value, env) : undefined;
      obj.properties.set(key, { value, writable: true, enumerable: true, configurable: true });
    }
    return obj;
  }

  private evalFunctionExpr(expr: AST.FunctionExpression, env: Environment): JSValue {
    return createFunction(expr.id?.name ?? 'anonymous', expr.params.map(p => (p as AST.Identifier).name), expr.body, env, expr.async);
  }

  private evalArrowFunction(expr: AST.ArrowFunctionExpression, env: Environment): JSValue {
    return createFunction('anonymous', expr.params.map(p => (p as AST.Identifier).name), expr.body, env, expr.async, true);
  }

  private evalSequence(expr: AST.SequenceExpression, env: Environment): JSValue {
    let result: JSValue;
    for (const e of expr.expressions) {
      result = this.evalExpr(e, env);
    }
    return result!;
  }

  // ── Global environment setup ─────────────────────────────────────────────

  createGlobalEnv(): Environment {
    const env = new Environment();
    env.markFunctionScope();
    env.setLocal('this', createObject(null));

    // console
    const consoleObj = createObject(null);
    consoleObj.properties.set('log', {
      value: createNativeFunction('log', (_this, args) => {
        this.output.push(args.map(a => toString(a)).join(' '));
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    consoleObj.properties.set('error', {
      value: createNativeFunction('error', (_this, args) => {
        this.output.push('ERROR: ' + args.map(a => toString(a)).join(' '));
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    consoleObj.properties.set('warn', {
      value: createNativeFunction('warn', (_this, args) => {
        this.output.push('WARN: ' + args.map(a => toString(a)).join(' '));
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    env.setLocal('console', consoleObj);

    // Math
    const mathObj = createObject(null);
    mathObj.properties.set('PI', { value: Math.PI, writable: false, enumerable: false, configurable: false });
    mathObj.properties.set('E', { value: Math.E, writable: false, enumerable: false, configurable: false });
    mathObj.properties.set('floor', { value: createNativeFunction('floor', (_this, args) => Math.floor(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('ceil', { value: createNativeFunction('ceil', (_this, args) => Math.ceil(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('round', { value: createNativeFunction('round', (_this, args) => Math.round(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('abs', { value: createNativeFunction('abs', (_this, args) => Math.abs(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('sqrt', { value: createNativeFunction('sqrt', (_this, args) => Math.sqrt(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('pow', { value: createNativeFunction('pow', (_this, args) => Math.pow(toNumber(args[0]), toNumber(args[1]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('log', { value: createNativeFunction('log', (_this, args) => Math.log(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('sin', { value: createNativeFunction('sin', (_this, args) => Math.sin(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('cos', { value: createNativeFunction('cos', (_this, args) => Math.cos(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('tan', { value: createNativeFunction('tan', (_this, args) => Math.tan(toNumber(args[0]))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('max', { value: createNativeFunction('max', (_this, args) => Math.max(...args.map(toNumber))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('min', { value: createNativeFunction('min', (_this, args) => Math.min(...args.map(toNumber))), writable: true, enumerable: true, configurable: true });
    mathObj.properties.set('random', { value: createNativeFunction('random', () => Math.random()), writable: true, enumerable: true, configurable: true });
    env.setLocal('Math', mathObj);

    env.setLocal('parseInt', createNativeFunction('parseInt', (_this, args) => parseInt(toString(args[0]), toNumber(args[1]) || 10)));
    env.setLocal('parseFloat', createNativeFunction('parseFloat', (_this, args) => parseFloat(toString(args[0]))));
    env.setLocal('isNaN', createNativeFunction('isNaN', (_this, args) => isNaN(toNumber(args[0]))));
    env.setLocal('isFinite', createNativeFunction('isFinite', (_this, args) => isFinite(toNumber(args[0]))));
    env.setLocal('encodeURI', createNativeFunction('encodeURI', (_this, args) => encodeURI(toString(args[0]))));
    env.setLocal('decodeURI', createNativeFunction('decodeURI', (_this, args) => decodeURI(toString(args[0]))));
    env.setLocal('encodeURIComponent', createNativeFunction('encodeURIComponent', (_this, args) => encodeURIComponent(toString(args[0]))));
    env.setLocal('decodeURIComponent', createNativeFunction('decodeURIComponent', (_this, args) => decodeURIComponent(toString(args[0]))));
    env.setLocal('String', createNativeFunction('String', (_this, args) => toString(args[0])));
    env.setLocal('Number', createNativeFunction('Number', (_this, args) => toNumber(args[0])));
    env.setLocal('Boolean', createNativeFunction('Boolean', (_this, args) => toBoolean(args[0])));
    env.setLocal('Array', createNativeFunction('Array', (_this, args) => createArray(args)));
    env.setLocal('Object', createNativeFunction('Object', (_this, args) => {
      if (typeof args[0] === 'object' && args[0] !== null) return args[0];
      return createObject(null);
    }));

    // JSON
    const toJSValue = (val: unknown): JSValue => {
      if (val === null || val === undefined) return val as JSValue;
      if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val as JSValue;
      if (Array.isArray(val)) return createArray(val.map(toJSValue));
      if (typeof val === 'object') {
        const obj = createObject(null);
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          obj.properties.set(k, { value: toJSValue(v), writable: true, enumerable: true, configurable: true });
        }
        return obj;
      }
      return undefined;
    };
    const jsonStrify = (val: JSValue): string | undefined => {
      if (val === undefined || typeof val === 'function') return undefined;
      if (val === null) return 'null';
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      if (typeof val === 'number') {
        if (Object.is(val, -0)) return '0';
        if (isNaN(val) || !isFinite(val)) return 'null';
        return String(val);
      }
      if (typeof val === 'string') return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
      if (typeof val === 'object') {
        const obj = val as JSObject;
        if (obj.type === 'array') {
          const len = Number(obj.properties.get('length')?.value ?? 0);
          const elems: string[] = [];
          for (let i = 0; i < len; i++) {
            const v = obj.properties.get(String(i))?.value;
            elems.push(jsonStrify(v) ?? 'null');
          }
          return `[${elems.join(',')}]`;
        }
        const pairs: string[] = [];
        for (const [k, desc] of obj.properties) {
          const v = desc.value;
          if (v === undefined || typeof v === 'function') continue;
          pairs.push(`"${k}":${jsonStrify(v) ?? 'null'}`);
        }
        return `{${pairs.join(',')}}`;
      }
      return toString(val);
    };
    env.setLocal('JSON', (() => {
      const json = createObject(null);
      json.properties.set('parse', { value: createNativeFunction('parse', (_this, args) => { try { return toJSValue(JSON.parse(toString(args[0]))); } catch { return undefined; } }), writable: true, enumerable: true, configurable: true });
      json.properties.set('stringify', { value: createNativeFunction('stringify', (_this, args) => { const r = jsonStrify(args[0]); return r === undefined ? undefined : r; }), writable: true, enumerable: true, configurable: true });
      return json;
    })());
    env.setLocal('TypeError', createNativeFunction('TypeError', (_this, args) => toString(args[0])));
    env.setLocal('ReferenceError', createNativeFunction('ReferenceError', (_this, args) => toString(args[0])));
    env.setLocal('Error', createNativeFunction('Error', (_this, args) => toString(args[0])));
    env.setLocal('RangeError', createNativeFunction('RangeError', (_this, args) => toString(args[0])));
    env.setLocal('SyntaxError', createNativeFunction('SyntaxError', (_this, args) => toString(args[0])));

    env.setLocal('setTimeout', createNativeFunction('setTimeout', (_this, args) => {
      const fn = args[0];
      const delay = toNumber(args[1]) || 0;
      if (typeof fn === 'object' && fn !== null && (fn as JSFunction).type === 'closure') {
        const jsFn = fn as JSFunction;
        this.taskQueue.push({
          fn: () => {
            const callEnv = new Environment(jsFn.closure);
            callEnv.markFunctionScope();
            const bodyNode = jsFn.body as AST.BlockStatement | AST.Expression;
            if (bodyNode.type === 'BlockStatement') {
              this.execBlock(bodyNode.body as AST.Statement[], callEnv);
            } else {
              this.evalExpr(bodyNode as AST.Expression, callEnv);
            }
          },
          delay,
        });
      }
      return this.taskQueue.length;
    }));
    env.setLocal('setInterval', createNativeFunction('setInterval', (_this, args) => {
      const fn = args[0];
      const delay = toNumber(args[1]) || 0;
      if (typeof fn === 'object' && fn !== null && (fn as JSFunction).type === 'closure') {
        const jsFn = fn as JSFunction;
        this.taskQueue.push({
          fn: () => {
            const callEnv = new Environment(jsFn.closure);
            callEnv.markFunctionScope();
            const bodyNode = jsFn.body as AST.BlockStatement | AST.Expression;
            if (bodyNode.type === 'BlockStatement') {
              this.execBlock(bodyNode.body as AST.Statement[], callEnv);
            } else {
              this.evalExpr(bodyNode as AST.Expression, callEnv);
            }
          },
          delay,
        });
      }
      return this.taskQueue.length;
    }));
    env.setLocal('clearTimeout', createNativeFunction('clearTimeout', () => undefined));
    env.setLocal('clearInterval', createNativeFunction('clearInterval', () => undefined));

    return env;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JS ERROR
// ─────────────────────────────────────────────────────────────────────────────

class JSError extends Error {
  value: JSValue;
  constructor(value: JSValue) {
    super(toString(value));
    this.value = value;
  }
}

export { JSError };
