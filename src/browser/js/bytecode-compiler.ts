// ─────────────────────────────────────────────────────────────────────────────
// BYTECODE COMPILER — AST → Bytecode
// Walks the parser's AST and emits stack-based bytecode.
// ─────────────────────────────────────────────────────────────────────────────

import type * as AST from './ast';
import { OP, BytecodeBuilder, type BytecodeFunction, type UpvalueInfo } from './bytecode';
import { type JSValue, createFunction, createNativeFunction, createObject, createArray, Environment } from './values';

// ── Scope tracking ───────────────────────────────────────────────────────────

interface VarSlot {
  name: string;
  slot: number;      // index into locals array
  depth: number;     // block depth at declaration
  kind: 'var' | 'let' | 'const';
}

interface BreakTarget {
  label: string | null;
  patchPos: number;  // bytecode position to patch
}

interface ContinueTarget {
  label: string | null;
  jumpPos: number;   // bytecode position to patch (jumps back to loop start)
}

interface LoopContext {
  continueTargets: ContinueTarget[];
  breakTargets: BreakTarget[];
  loopStart: number;
}

interface TryContext {
  startOffset: number;
}

// ── Compiler ─────────────────────────────────────────────────────────────────

export class BytecodeCompiler {
  private builder = new BytecodeBuilder();
  private scopes: Map<string, VarSlot>[] = [new Map()];
  private globals = new Set<string>();
  private depth = 0;
  private locals: VarSlot[] = [];
  private nextSlot = 0;
  private loopStack: LoopContext[] = [];
  private breakStack: BreakTarget[] = [];
  private continueStack: ContinueTarget[] = [];
  private tryStack: TryContext[] = [];
  private hasReturn = false;

  // Compile a program (top-level)
  compile(program: AST.Program): BytecodeFunction {
    // First pass: hoist function declarations
    for (const stmt of program.body) {
      if (stmt.type === 'FunctionDeclaration' && stmt.id) {
        this.declareLocal(stmt.id.name, 'var');
      }
    }

    // Compile body — keep last expression result on stack
    for (let i = 0; i < program.body.length; i++) {
      const stmt = program.body[i]!;
      const isLast = i === program.body.length - 1;
      if (isLast && stmt.type === 'ExpressionStatement') {
        this.compileExpression(stmt.expression);
        // Leave result on stack as program return value
      } else {
        this.compileStatement(stmt);
      }
    }

    if (program.body.length === 0) {
      this.builder.emit(OP.PUSH_UNDEFINED);
    }

    return this.builder.build(0, this.nextSlot, '<program>', false, false, false, []);
  }

  // ── Statement compilation ────────────────────────────────────────────────

  private compileStatement(stmt: AST.Statement | null): void {
    if (!stmt) return;
    switch (stmt.type) {
      case 'ExpressionStatement': this.compileExprStatement(stmt); break;
      case 'BlockStatement': this.compileBlock(stmt); break;
      case 'EmptyStatement': break;
      case 'ReturnStatement': this.compileReturn(stmt); break;
      case 'IfStatement': this.compileIf(stmt); break;
      case 'WhileStatement': this.compileWhile(stmt); break;
      case 'DoWhileStatement': this.compileDoWhile(stmt); break;
      case 'ForStatement': this.compileFor(stmt); break;
      case 'ForInStatement': this.compileForIn(stmt); break;
      case 'ForOfStatement': this.compileForOf(stmt); break;
      case 'SwitchStatement': this.compileSwitch(stmt); break;
      case 'TryStatement': this.compileTry(stmt); break;
      case 'ThrowStatement': this.compileThrow(stmt); break;
      case 'BreakStatement': this.compileBreak(stmt); break;
      case 'ContinueStatement': this.compileContinue(stmt); break;
      case 'LabeledStatement': this.compileLabeled(stmt); break;
      case 'DebuggerStatement': this.builder.emit(OP.DEBUGGER); break;
      case 'VariableDeclaration': this.compileVarDecl(stmt); break;
      case 'FunctionDeclaration': this.compileFuncDecl(stmt); break;
      case 'ClassDeclaration': this.compileClassDecl(stmt); break;
    }
  }

  private compileExprStatement(stmt: AST.ExpressionStatement): void {
    this.compileExpression(stmt.expression);
    this.builder.emit(OP.POP);
  }

  private compileBlock(block: AST.BlockStatement): void {
    this.pushScope();
    // Hoist function declarations first
    for (const stmt of block.body) {
      if (stmt.type === 'FunctionDeclaration' && stmt.id) {
        this.declareLocal(stmt.id.name, 'var');
      }
    }
    for (const stmt of block.body) {
      this.compileStatement(stmt);
    }
    this.popScope();
  }

  private compileReturn(stmt: AST.ReturnStatement): void {
    if (stmt.argument) {
      this.compileExpression(stmt.argument);
    } else {
      this.builder.emit(OP.PUSH_UNDEFINED);
    }
    this.builder.emit(OP.RETURN);
    this.hasReturn = true;
  }

  private compileIf(stmt: AST.IfStatement): void {
    this.compileExpression(stmt.test);
    const elseJump = this.builder.emitJump(OP.JMP_IF_FALSE);
    this.builder.emit(OP.POP);
    this.compileStatement(stmt.consequent);
    if (stmt.alternate) {
      const endJump = this.builder.emitJump(OP.JMP);
      this.builder.patchJump(elseJump);
      this.builder.emit(OP.POP);
      this.compileStatement(stmt.alternate);
      this.builder.patchJump(endJump);
    } else {
      this.builder.patchJump(elseJump);
      this.builder.emit(OP.POP);
    }
  }

  private compileWhile(stmt: AST.WhileStatement): void {
    const loopStart = this.builder.currentOffset();
    this.compileExpression(stmt.test);
    const exitJump = this.builder.emitJump(OP.JMP_IF_FALSE);
    this.builder.emit(OP.POP);
    this.pushLoop(loopStart, exitJump);
    this.compileStatement(stmt.body);
    this.popLoop(loopStart);
    this.builder.emitU16(OP.JMP, loopStart);
    this.builder.patchJump(exitJump);
    this.builder.emit(OP.POP);
  }

  private compileDoWhile(stmt: AST.DoWhileStatement): void {
    const loopStart = this.builder.currentOffset();
    const exitJumpPos = -1;
    this.pushLoop(loopStart, exitJumpPos);
    this.compileStatement(stmt.body);
    this.popLoop(loopStart);
    this.compileExpression(stmt.test);
    const exitJump = this.builder.emitJump(OP.JMP_IF_FALSE);
    this.builder.emit(OP.POP);
    this.builder.emitU16(OP.JMP, loopStart);
    this.builder.patchJump(exitJump);
    this.builder.emit(OP.POP);
  }

  private compileFor(stmt: AST.ForStatement): void {
    this.pushScope();
    if (stmt.init) {
      if (stmt.init.type === 'VariableDeclaration') {
        this.compileVarDecl(stmt.init);
      } else {
        this.compileExpression(stmt.init);
        this.builder.emit(OP.POP);
      }
    }
    const loopStart = this.builder.currentOffset();
    let exitJumpPos = -1;
    if (stmt.test) {
      this.compileExpression(stmt.test);
      exitJumpPos = this.builder.emitJump(OP.JMP_IF_FALSE);
      this.builder.emit(OP.POP);
    }
    this.pushLoop(loopStart, exitJumpPos);
    this.compileStatement(stmt.body);
    this.popLoop(loopStart);
    if (stmt.update) {
      this.compileExpression(stmt.update);
      this.builder.emit(OP.POP);
    }
    this.builder.emitU16(OP.JMP, loopStart);
    if (exitJumpPos >= 0) {
      this.builder.patchJump(exitJumpPos);
      this.builder.emit(OP.POP);
    }
    this.popScope();
  }

  private compileForIn(stmt: AST.ForInStatement): void {
    this.pushScope();
    const varName = stmt.left.type === 'VariableDeclaration'
      ? (stmt.left.declarations[0]!.id as AST.Identifier).name
      : stmt.left.name;

    // Step 1: Evaluate the object, store in local
    this.compileExpression(stmt.right);
    const objSlot = this.allocateLocal('_fi_obj');
    this.builder.emitU16(OP.STORE_LOCAL, objSlot);

    // Step 2: Call Object.keys(obj) to get keys array, store in local
    // Push global "Object"
    const objectNameIdx = this.builder.addConst('Object');
    this.builder.emitU16(OP.LOAD_GLOBAL, objectNameIdx);
    // Push "keys"
    const keysNameIdx = this.builder.addConst('keys');
    this.builder.emitU16(OP.PROP_GET_NAME, keysNameIdx);
    // Push obj
    this.builder.emitU16(OP.LOAD_LOCAL, objSlot);
    // Call Object.keys(obj) — 1 arg
    this.builder.emit(OP.SWAP);
    this.builder.emitU16(OP.CALL, 1);
    const keysSlot = this.allocateLocal('_fi_keys');
    this.builder.emitU16(OP.STORE_LOCAL, keysSlot);

    // Step 3: Push index = 0
    this.builder.emit(OP.PUSH_ZERO);
    const idxSlot = this.allocateLocal('_fi_idx');
    this.builder.emitU16(OP.STORE_LOCAL, idxSlot);

    // Step 4: Loop start — check idx < keys.length
    const loopStart = this.builder.currentOffset();
    this.builder.emitU16(OP.LOAD_LOCAL, idxSlot);
    this.builder.emitU16(OP.LOAD_LOCAL, keysSlot);
    const lengthIdx = this.builder.addConst('length');
    this.builder.emitU16(OP.PROP_GET_NAME, lengthIdx);
    this.builder.emit(OP.LT);
    const exitJump = this.builder.emitJump(OP.JMP_IF_FALSE);
    this.builder.emit(OP.POP);

    // Step 5: Get keys[idx] and assign to varName
    this.builder.emitU16(OP.LOAD_LOCAL, keysSlot);
    this.builder.emitU16(OP.LOAD_LOCAL, idxSlot);
    this.builder.emit(OP.COMPUTED_GET);

    const existing = this.resolveLocal(varName);
    if (existing) {
      this.builder.emitU16(OP.STORE_LOCAL, existing.slot);
    } else {
      this.declareLocal(varName, 'let');
      const slot = this.resolveLocal(varName)!.slot;
      this.builder.emitU16(OP.STORE_LOCAL, slot);
    }

    // Step 6: Body
    this.pushLoop(loopStart, exitJump);
    this.compileStatement(stmt.body);
    this.popLoop(loopStart);

    // Step 7: idx++, jump back
    this.builder.emitU16(OP.LOAD_LOCAL, idxSlot);
    this.builder.emit(OP.PUSH_ONE);
    this.builder.emit(OP.ADD);
    this.builder.emitU16(OP.STORE_LOCAL, idxSlot);
    this.builder.emit(OP.POP);
    this.builder.emitU16(OP.JMP, loopStart);

    // Step 8: Exit
    this.builder.patchJump(exitJump);
    this.builder.emit(OP.POP);

    this.freeLocal(); // idx
    this.freeLocal(); // keys
    this.freeLocal(); // obj
    this.popScope();
  }

  private compileForOf(stmt: AST.ForOfStatement): void {
    this.pushScope();
    const varName = stmt.left.type === 'VariableDeclaration'
      ? (stmt.left.declarations[0]!.id as AST.Identifier).name
      : stmt.left.name;

    // Evaluate iterable
    this.compileExpression(stmt.right);
    const iterSlot = this.allocateLocal('_fo_iter');
    this.builder.emitU16(OP.STORE_LOCAL, iterSlot);

    // Create index
    this.builder.emit(OP.PUSH_ZERO);
    const idxSlot = this.allocateLocal('_fo_idx');
    this.builder.emitU16(OP.STORE_LOCAL, idxSlot);

    // Get length: iterable.length
    const lengthIdx = this.builder.addConst('length');

    const loopStart = this.builder.currentOffset();

    // Check: idx < length
    this.builder.emitU16(OP.LOAD_LOCAL, iterSlot);
    this.builder.emitU16(OP.PROP_GET_NAME, lengthIdx);
    this.builder.emitU16(OP.LOAD_LOCAL, idxSlot);
    this.builder.emit(OP.LT);
    const exitJump = this.builder.emitJump(OP.JMP_IF_FALSE);
    this.builder.emit(OP.POP);

    // Get element: iterable[idx]
    this.builder.emitU16(OP.LOAD_LOCAL, iterSlot);
    this.builder.emitU16(OP.LOAD_LOCAL, idxSlot);
    this.builder.emit(OP.COMPUTED_GET);

    // Declare or assign loop variable
    const existing = this.resolveLocal(varName);
    if (existing) {
      this.builder.emitU16(OP.STORE_LOCAL, existing.slot);
    } else {
      this.declareLocal(varName, 'let');
      const slot = this.resolveLocal(varName)!.slot;
      this.builder.emitU16(OP.STORE_LOCAL, slot);
    }

    // Loop body
    this.pushLoop(loopStart, exitJump);
    this.compileStatement(stmt.body);
    this.popLoop(loopStart);

    // idx++
    this.builder.emitU16(OP.LOAD_LOCAL, idxSlot);
    this.builder.emit(OP.PUSH_ONE);
    this.builder.emit(OP.ADD);
    this.builder.emitU16(OP.STORE_LOCAL, idxSlot);
    this.builder.emit(OP.POP);

    // Jump back
    this.builder.emitU16(OP.JMP, loopStart);

    // Exit
    this.builder.patchJump(exitJump);
    this.builder.emit(OP.POP);

    this.freeLocal(); // idx
    this.freeLocal(); // iter
    this.popScope();
  }

  private compileSwitch(stmt: AST.SwitchStatement): void {
    this.compileExpression(stmt.discriminant);
    const discSlot = this.allocateLocal('_sw_disc');
    this.builder.emitU16(OP.STORE_LOCAL, discSlot);

    const caseJumps: { testOffset: number; bodyStart: number }[] = [];
    const endJumps: number[] = [];

    for (let i = 0; i < stmt.cases.length; i++) {
      const c = stmt.cases[i]!;
      if (c.test) {
        this.builder.emitU16(OP.LOAD_LOCAL, discSlot);
        this.compileExpression(c.test);
        this.builder.emit(OP.SEQ);
        caseJumps.push({ testOffset: this.builder.emitJump(OP.JMP_IF_FALSE), bodyStart: -1 });
        this.builder.emit(OP.POP);
      }
      caseJumps[i]!.bodyStart = this.builder.currentOffset();
      for (const s of c.consequent) {
        this.compileStatement(s);
      }
      // If this case doesn't fall through, we need a jump to end
      // (fall-through is the default in switch)
    }

    // Patch all case test jumps to point to next case body (or end)
    for (let i = 0; i < caseJumps.length; i++) {
      const cj = caseJumps[i]!;
      if (i + 1 < caseJumps.length) {
        this.builder.patchJumpTo(cj.testOffset, caseJumps[i + 1]!.bodyStart);
      }
      // The test jump target goes past the POP to the next case body
      this.builder.patchJumpTo(cj.testOffset, i + 1 < caseJumps.length ? caseJumps[i + 1]!.bodyStart : this.builder.currentOffset());
    }

    // Patch breaks
    this.patchBreaks();

    this.freeLocal(); // discSlot
    this.popScope();
  }

  private compileTry(stmt: AST.TryStatement): void {
    const tryStart = this.builder.currentOffset();
    this.tryStack.push({ startOffset: tryStart });

    this.compileBlock(stmt.block);

    const tryEnd = this.builder.currentOffset();
    const handlerJump = this.builder.emitJump(OP.JMP); // skip catch if no exception

    if (stmt.handler) {
      const handlerStart = this.builder.currentOffset();
      // Exception value is on stack from VM's exception handling
      // Store it in the catch variable
      if (stmt.handler.param) {
        this.declareLocal(stmt.handler.param.name, 'let');
        const slot = this.resolveLocal(stmt.handler.param.name)!.slot;
        this.builder.emitU16(OP.STORE_LOCAL, slot);
        this.builder.emit(OP.POP);
      }
      this.compileBlock(stmt.handler.body);
    }

    const afterCatch = this.builder.currentOffset();
    this.builder.patchJump(handlerJump);

    // Register try handler
    this.builder.addTryHandler(tryStart, tryEnd, handlerStart!);

    if (stmt.finalizer) {
      this.compileBlock(stmt.finalizer);
    }

    this.tryStack.pop();
  }

  private compileThrow(stmt: AST.ThrowStatement): void {
    this.compileExpression(stmt.argument);
    this.builder.emit(OP.THROW);
  }

  private compileBreak(stmt: AST.BreakStatement): void {
    const label = stmt.label?.name ?? null;
    const pos = this.builder.emitJump(OP.BREAK);
    this.breakStack.push({ label, patchPos: pos });
  }

  private compileContinue(stmt: AST.ContinueStatement): void {
    const label = stmt.label?.name ?? null;
    const pos = this.builder.emitJump(OP.CONTINUE);
    this.continueStack.push({ label, patchPos: pos });
  }

  private compileLabeled(stmt: AST.LabeledStatement): void {
    // Labeled statements wrap loops or blocks. We handle break/continue
    // by checking labels in the loop compilation methods.
    this.compileStatement(stmt.body);
  }

  private compileVarDecl(stmt: AST.VariableDeclaration): void {
    for (const decl of stmt.declarations) {
      if (decl.id.type === 'Identifier') {
        const existing = this.resolveLocal(decl.id.name);
        if (existing) {
          if (decl.init) {
            this.compileExpression(decl.init);
            this.builder.emitU16(OP.STORE_LOCAL, existing.slot);
          }
        } else {
          this.declareLocal(decl.id.name, stmt.kind);
          const slot = this.resolveLocal(decl.id.name)!.slot;
          if (decl.init) {
            this.compileExpression(decl.init);
          } else {
            this.builder.emit(OP.PUSH_UNDEFINED);
          }
          this.builder.emitU16(OP.STORE_LOCAL, slot);
        }
      } else if (decl.id.type === 'AssignmentPattern') {
        // Destructuring with default: var [a, b] = expr
        if (decl.init) {
          this.compileExpression(decl.init);
        } else {
          this.builder.emit(OP.PUSH_UNDEFINED);
        }
        this.compileDestructurePattern(decl.id.left, stmt.kind);
      }
    }
  }

  private compileDestructurePattern(
    pattern: AST.Identifier | AST.ArrayPattern | AST.ObjectPattern,
    kind: 'var' | 'let' | 'const',
  ): void {
    if (pattern.type === 'Identifier') {
      const existing = this.resolveLocal(pattern.name);
      if (existing) {
        this.builder.emitU16(OP.STORE_LOCAL, existing.slot);
      } else {
        this.declareLocal(pattern.name, kind);
        this.builder.emitU16(OP.STORE_LOCAL, this.resolveLocal(pattern.name)!.slot);
      }
      this.builder.emit(OP.POP);
    } else if (pattern.type === 'ArrayPattern') {
      for (let i = 0; i < pattern.elements.length; i++) {
        const el = pattern.elements[i];
        if (!el) { this.builder.emit(OP.POP); continue; }
        this.builder.emit(OP.DUP);
        this.builder.emit(OP.PUSH_CONST, this.builder.addConst(i));
        this.builder.emit(OP.COMPUTED_GET);
        if (el.type === 'Identifier') {
          const existing = this.resolveLocal(el.name);
          if (existing) {
            this.builder.emitU16(OP.STORE_LOCAL, existing.slot);
          } else {
            this.declareLocal(el.name, kind);
            this.builder.emitU16(OP.STORE_LOCAL, this.resolveLocal(el.name)!.slot);
          }
          this.builder.emit(OP.POP);
        } else if (el.type === 'AssignmentPattern') {
          // TODO: default value in destructuring
          this.builder.emit(OP.POP);
        } else {
          this.builder.emit(OP.POP);
        }
      }
      this.builder.emit(OP.POP); // pop original array
    } else if (pattern.type === 'ObjectPattern') {
      // TODO: full object destructuring
      this.builder.emit(OP.POP);
    }
  }

  private compileFuncDecl(stmt: AST.FunctionDeclaration): void {
    const fn = this.compileFunctionExpr(
      { type: 'FunctionExpression', id: stmt.id, params: stmt.params, body: stmt.body, async: stmt.async, generator: stmt.generator },
    );
    const slot = this.resolveLocal(stmt.id.name);
    if (slot) {
      this.builder.emitU16(OP.STORE_LOCAL, slot.slot);
    }
  }

  private compileClassDecl(stmt: AST.ClassDeclaration): void {
    const className = stmt.id?.name ?? 'Anonymous';

    // Compile class as a closure that builds the class object.
    // The closure captures the class body and evaluates it at call time.
    const classCompiler = new BytecodeCompiler();
    classCompiler.pushScope();

    // Allocate locals for class methods
    const ctorParamNames: string[] = [];
    if (stmt.body.body) {
      for (const member of stmt.body.body) {
        if (member.type === 'MethodDefinition' && member.kind === 'constructor' && member.value.type === 'FunctionExpression') {
          for (const p of member.value.params) {
            if (p.type === 'Identifier') ctorParamNames.push(p.name);
          }
        }
      }
    }

    // Store class methods as constants for the VM to build the class at runtime
    const classBodyIdx = classCompiler.builder.addConst(stmt as unknown as JSValue);
    classCompiler.builder.emitU16(OP.PUSH_CONST, classBodyIdx);
    classCompiler.builder.emit(OP.DEBUGGER); // CLASS_BUILD placeholder — VM interprets

    classCompiler.builder.emit(OP.RETURN);

    const fnObj = classCompiler.builder.build(
      0, classCompiler.nextSlot, className,
      false, false, false, [],
    );

    // Declare and assign the class
    this.declareLocal(className, 'var');
    const slot = this.resolveLocal(className)!.slot;
    this.builder.emitU16(OP.CLOSURE, this.builder.addConst(fnObj));
    // Call the closure to instantiate the class
    this.builder.emitU16(OP.CALL, 0);
    this.builder.emitU16(OP.STORE_LOCAL, slot);
  }

  private compileFunctionExpr(expr: AST.FunctionExpression | AST.ArrowFunctionExpression): void {
    const isArrow = expr.type === 'ArrowFunctionExpression';
    const fnCompiler = new BytecodeCompiler();

    // Count params (including defaults/rest)
    let paramCount = 0;
    for (const p of expr.params) {
      if (p.type === 'RestElement') { paramCount++; break; }
      if (p.type === 'Identifier') { paramCount++; }
      else if (p.type === 'AssignmentPattern') { paramCount++; }
      else { paramCount++; }
    }

    // Compile function body
    fnCompiler.pushScope();
    let slotIdx = 0;

    // Allocate params as locals
    for (const p of expr.params) {
      if (p.type === 'Identifier') {
        fnCompiler.declareLocal(p.name, 'var');
        // Initialize param slot
        fnCompiler.builder.emitU16(OP.LOAD_ARGUMENTS);
        fnCompiler.builder.emit(OP.PUSH_CONST, fnCompiler.builder.addConst(slotIdx));
        fnCompiler.builder.emit(OP.COMPUTED_GET);
        fnCompiler.builder.emitU16(OP.STORE_LOCAL, fnCompiler.resolveLocal(p.name)!.slot);
        fnCompiler.builder.emit(OP.POP);
        slotIdx++;
      } else if (p.type === 'RestElement') {
        // Rest params: collect remaining args into an array
        fnCompiler.declareLocal((p.argument as AST.Identifier).name, 'var');
        slotIdx++;
      } else if (p.type === 'AssignmentPattern') {
        // Default params
        fnCompiler.declareLocal((p.left as AST.Identifier).name, 'var');
        slotIdx++;
      }
    }

    // For arrow functions, `this` is inherited from enclosing scope
    if (!isArrow) {
      fnCompiler.declareLocal('this', 'var');
    }
    fnCompiler.declareLocal('arguments', 'var');

    if (expr.body.type === 'BlockStatement') {
      for (const s of expr.body.body) {
        fnCompiler.compileStatement(s);
      }
    } else {
      fnCompiler.compileExpression(expr.body);
      fnCompiler.builder.emit(OP.RETURN);
    }

    const fnName = expr.type === 'FunctionExpression' ? (expr.id?.name ?? 'anonymous') : 'arrow';
    const upvalues: UpvalueInfo[] = [];
    const fnObj = fnCompiler.builder.build(
      paramCount, fnCompiler.nextSlot, fnName,
      isArrow, expr.async ?? false, expr.generator ?? false,
      upvalues,
    );

    // Push the compiled function as a constant
    this.builder.emitU16(OP.CLOSURE, this.builder.addConst(fnObj));
  }

  // ── Expression compilation ───────────────────────────────────────────────

  private compileExpression(expr: AST.Expression): void {
    if (!expr) {
      this.builder.emit(OP.PUSH_UNDEFINED);
      return;
    }
    switch (expr.type) {
      case 'Literal': this.compileLiteral(expr); break;
      case 'Identifier': this.compileIdentifier(expr); break;
      case 'ThisExpression': this.builder.emit(OP.LOAD_THIS); break;
      case 'SuperExpression': this.builder.emit(OP.LOAD_THIS); break;
      case 'UnaryExpression': this.compileUnary(expr); break;
      case 'UpdateExpression': this.compileUpdate(expr); break;
      case 'BinaryExpression': this.compileBinary(expr); break;
      case 'LogicalExpression': this.compileLogical(expr); break;
      case 'AssignmentExpression': this.compileAssignment(expr); break;
      case 'ConditionalExpression': this.compileConditional(expr); break;
      case 'CallExpression': this.compileCall(expr); break;
      case 'NewExpression': this.compileNew(expr); break;
      case 'MemberExpression': this.compileMember(expr); break;
      case 'ArrayExpression': this.compileArray(expr); break;
      case 'ObjectExpression': this.compileObject(expr); break;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        this.compileFunctionExpr(expr);
        break;
      case 'SequenceExpression': this.compileSequence(expr); break;
      case 'TemplateLiteral': this.compileTemplateLiteral(expr); break;
      case 'AwaitExpression':
        this.compileExpression(expr.argument);
        this.builder.emit(OP.AWAIT);
        break;
      case 'YieldExpression':
        if (expr.argument) this.compileExpression(expr.argument);
        this.builder.emit(OP.YIELD);
        break;
      default:
        this.builder.emit(OP.PUSH_UNDEFINED);
        break;
    }
  }

  private compileLiteral(expr: AST.Literal): void {
    const val = expr.value;
    if (val === null) {
      this.builder.emit(OP.PUSH_NULL);
    } else if (val === undefined) {
      this.builder.emit(OP.PUSH_UNDEFINED);
    } else if (typeof val === 'boolean') {
      this.builder.emit(val ? OP.PUSH_TRUE : OP.PUSH_FALSE);
    } else if (typeof val === 'number') {
      if (val === 0) this.builder.emit(OP.PUSH_ZERO);
      else if (val === 1) this.builder.emit(OP.PUSH_ONE);
      else if (val === -1) this.builder.emit(OP.PUSH_NEG_ONE);
      else this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(val));
    } else if (typeof val === 'string') {
      this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(val));
    } else if (typeof val === 'bigint') {
      this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(val));
    } else if (val && typeof val === 'object' && 'type' in val) {
      // RegExpLiteral — store as raw string for now
      this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(expr.raw));
    } else {
      this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(val as JSValue));
    }
  }

  private compileIdentifier(expr: AST.Identifier): void {
    const local = this.resolveLocal(expr.name);
    if (local) {
      this.builder.emitU16(OP.LOAD_LOCAL, local.slot);
    } else {
      this.builder.emitU16(OP.LOAD_GLOBAL, this.builder.addConst(expr.name));
    }
  }

  private compileUnary(expr: AST.UnaryExpression): void {
    if (expr.operator === 'typeof') {
      this.compileExpression(expr.argument);
      this.builder.emit(OP.TYPEOF);
      return;
    }
    if (expr.operator === 'void') {
      this.compileExpression(expr.argument);
      this.builder.emit(OP.VOID_OP);
      return;
    }
    if (expr.operator === 'delete') {
      this.builder.emit(OP.PUSH_TRUE); // simplified
      return;
    }
    this.compileExpression(expr.argument);
    switch (expr.operator) {
      case '-': this.builder.emit(OP.NEGATE); break;
      case '+': this.builder.emit(OP.PLUS); break;
      case '!': this.builder.emit(OP.NOT); break;
      case '~': this.builder.emit(OP.BITNOT); break;
    }
  }

  private compileUpdate(expr: AST.UpdateExpression): void {
    if (expr.argument.type === 'MemberExpression') {
      // ++/-- on property: need to get, add, set
      this.compileMemberForUpdate(expr.argument);
      this.builder.emit(expr.operator === '++' ? OP.PUSH_ONE : OP.PUSH_NEG_ONE);
      this.builder.emit(OP.ADD);
      // Store back
      if (expr.argument.computed) {
        // Stack: obj, key, newVal → store
        if (expr.prefix) {
          this.builder.emit(OP.DUP); // keep newVal
          this.builder.emit(OP.COMPUTED_SET);
        } else {
          this.builder.emit(OP.COMPUTED_SET);
        }
      } else {
        if (expr.prefix) {
          this.builder.emit(OP.DUP);
          this.builder.emit(OP.PROP_SET);
        } else {
          this.builder.emit(OP.PROP_SET);
        }
      }
      if (!expr.prefix) {
        // Return old value (newVal - 1 or newVal + 1)
        this.builder.emit(expr.operator === '++' ? OP.PUSH_ONE : OP.PUSH_NEG_ONE);
        this.builder.emit(OP.SUB);
      }
    } else {
      const name = (expr.argument as AST.Identifier).name;
      const local = this.resolveLocal(name);
      if (local) {
        this.builder.emitU16(OP.LOAD_LOCAL, local.slot);
        if (!expr.prefix) this.builder.emit(OP.DUP); // save old for postfix
        this.builder.emit(expr.operator === '++' ? OP.PUSH_ONE : OP.PUSH_NEG_ONE);
        this.builder.emit(OP.ADD);
        this.builder.emitU16(OP.STORE_LOCAL, local.slot);
        this.builder.emit(OP.POP); // pop the stored value
        if (expr.prefix) {
          // top is already new value
        }
        // For postfix, old value is below the new value on stack (saved by DUP)
      } else {
        this.builder.emitU16(OP.LOAD_GLOBAL, this.builder.addConst(name));
        if (!expr.prefix) this.builder.emit(OP.DUP);
        this.builder.emit(expr.operator === '++' ? OP.PUSH_ONE : OP.PUSH_NEG_ONE);
        this.builder.emit(OP.ADD);
        this.builder.emitU16(OP.STORE_GLOBAL, this.builder.addConst(name));
        this.builder.emit(OP.POP);
      }
    }
  }

  /** Load object and key for update expressions on members. */
  private compileMemberForUpdate(member: AST.MemberExpression): void {
    this.compileExpression(member.object);
    if (member.computed) {
      this.compileExpression(member.property);
    } else {
      const name = (member.property as AST.Identifier).name;
      this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(name));
    }
  }

  private compileBinary(expr: AST.BinaryExpression): void {
    this.compileExpression(expr.left);
    this.compileExpression(expr.right);
    switch (expr.operator) {
      case '+': this.builder.emit(OP.ADD); break;
      case '-': this.builder.emit(OP.SUB); break;
      case '*': this.builder.emit(OP.MUL); break;
      case '/': this.builder.emit(OP.DIV); break;
      case '%': this.builder.emit(OP.MOD); break;
      case '**': this.builder.emit(OP.POW); break;
      case '<': this.builder.emit(OP.LT); break;
      case '>': this.builder.emit(OP.GT); break;
      case '<=': this.builder.emit(OP.LTE); break;
      case '>=': this.builder.emit(OP.GTE); break;
      case '==': this.builder.emit(OP.EQ); break;
      case '!=': this.builder.emit(OP.NEQ); break;
      case '===': this.builder.emit(OP.SEQ); break;
      case '!==': this.builder.emit(OP.SNEQ); break;
      case '&': this.builder.emit(OP.BITAND); break;
      case '|': this.builder.emit(OP.BITOR); break;
      case '^': this.builder.emit(OP.BITXOR); break;
      case '<<': this.builder.emit(OP.SHL); break;
      case '>>': this.builder.emit(OP.SHR); break;
      case '>>>': this.builder.emit(OP.USHR); break;
      case 'instanceof': this.builder.emit(OP.INSTANCEOF); break;
      case 'in': this.builder.emit(OP.IN); break;
    }
  }

  private compileLogical(expr: AST.LogicalExpression): void {
    this.compileExpression(expr.left);
    if (expr.operator === '&&') {
      const falseJump = this.builder.emitJump(OP.JMP_IF_FALSE);
      this.builder.emit(OP.POP);
      this.compileExpression(expr.right);
      this.builder.patchJump(falseJump);
    } else if (expr.operator === '||') {
      const trueJump = this.builder.emitJump(OP.JMP_IF_TRUE);
      this.builder.emit(OP.POP);
      this.compileExpression(expr.right);
      this.builder.patchJump(trueJump);
    } else if (expr.operator === '??') {
      // left ?? right
      // If left is nullish, jump to eval right; otherwise keep left
      const dupPos = this.builder.emit(OP.DUP);
      const nullishJump = this.builder.emitJump(OP.JMP_IF_NULLISH);
      // Left is NOT nullish: pop the dup'd left (original stays), jump past right
      this.builder.emit(OP.POP); // pop the dup
      const endJump = this.builder.emitJump(OP.JMP);
      // Left IS nullish: pop the original left, eval right
      this.builder.patchJump(nullishJump);
      this.builder.emit(OP.POP); // pop nullish left
      this.compileExpression(expr.right);
      this.builder.patchJump(endJump);
    }
  }

  private compileAssignment(expr: AST.AssignmentExpression): void {
    this.compileExpression(expr.right);

    if (expr.left.type === 'MemberExpression') {
      const member = expr.left;
      this.compileExpression(member.object);
      if (member.computed) {
        this.compileExpression(member.property);
      } else {
        this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst((member.property as AST.Identifier).name));
      }
      // Stack: value, obj, key
      if (expr.operator === '=') {
        // Just store
        if (member.computed) {
          this.builder.emit(OP.COMPUTED_SET);
        } else {
          this.builder.emit(OP.PROP_SET);
        }
      } else {
        // Compound: obj.key op= value → get old, compute, set
        if (member.computed) {
          this.builder.emit(OP.COMPUTED_GET); // get old
          this.builder.emit(OP.SWAP); // old, new
        } else {
          this.builder.emit(OP.PROP_GET_NAME);
          this.builder.emit(OP.SWAP);
        }
        // TODO: compound assignment on members
        if (member.computed) {
          this.builder.emit(OP.COMPUTED_SET);
        } else {
          this.builder.emit(OP.PROP_SET);
        }
      }
    } else {
      const name = (expr.left as AST.Identifier).name;
      const local = this.resolveLocal(name);

      if (expr.operator === '=') {
        if (local) {
          this.builder.emitU16(OP.STORE_LOCAL, local.slot);
        } else {
          this.builder.emitU16(OP.STORE_GLOBAL, this.builder.addConst(name));
        }
      } else {
        // Compound assignment: a op= b → a = a op b
        if (local) {
          this.builder.emitU16(OP.LOAD_LOCAL, local.slot);
        } else {
          this.builder.emitU16(OP.LOAD_GLOBAL, this.builder.addConst(name));
        }
        this.builder.emit(OP.SWAP);
        switch (expr.operator) {
          case '+=': this.builder.emit(OP.ADD); break;
          case '-=': this.builder.emit(OP.SUB); break;
          case '*=': this.builder.emit(OP.MUL); break;
          case '/=': this.builder.emit(OP.DIV); break;
          case '%=': this.builder.emit(OP.MOD); break;
          case '**=': this.builder.emit(OP.POW); break;
          case '&=': this.builder.emit(OP.BITAND); break;
          case '|=': this.builder.emit(OP.BITOR); break;
          case '^=': this.builder.emit(OP.BITXOR); break;
          case '<<=': this.builder.emit(OP.SHL); break;
          case '>>=': this.builder.emit(OP.SHR); break;
          case '>>>=': this.builder.emit(OP.USHR); break;
          case '??=': {
            // a ??= b → a = (a ?? b)
            // Stack: old_a, new_b. Need: if old_a != null/undefined, keep old_a, else new_b
            const skipJump = this.builder.emitJump(OP.JMP_IF_NULLISH);
            // old_a is not nullish → pop new_b, keep old_a
            this.builder.emit(OP.SWAP);
            this.builder.emit(OP.POP);
            this.builder.patchJump(skipJump);
            break;
          }
          case '||=': {
            const skipJump = this.builder.emitJump(OP.JMP_IF_TRUE);
            this.builder.emit(OP.SWAP);
            this.builder.emit(OP.POP);
            this.builder.patchJump(skipJump);
            break;
          }
          case '&&=': {
            const skipJump = this.builder.emitJump(OP.JMP_IF_FALSE);
            this.builder.emit(OP.SWAP);
            this.builder.emit(OP.POP);
            this.builder.patchJump(skipJump);
            break;
          }
        }
        if (local) {
          this.builder.emitU16(OP.STORE_LOCAL, local.slot);
        } else {
          this.builder.emitU16(OP.STORE_GLOBAL, this.builder.addConst(name));
        }
      }
    }
  }

  private compileConditional(expr: AST.ConditionalExpression): void {
    this.compileExpression(expr.test);
    const elseJump = this.builder.emitJump(OP.JMP_IF_FALSE);
    this.builder.emit(OP.POP);
    this.compileExpression(expr.consequent);
    const endJump = this.builder.emitJump(OP.JMP);
    this.builder.patchJump(elseJump);
    this.builder.emit(OP.POP);
    this.compileExpression(expr.alternate);
    this.builder.patchJump(endJump);
  }

  private compileCall(expr: AST.CallExpression): void {
    // Check for spread arguments
    const hasSpread = expr.arguments.some(a => a.type === 'SpreadElement');
    if (hasSpread) {
      this.compileCallWithSpread(expr);
      return;
    }

    if (expr.callee.type === 'MemberExpression') {
      const member = expr.callee;
      // Push object, resolve method, then push args
      this.compileExpression(member.object);
      if (member.computed) {
        this.compileExpression(member.property);
      } else {
        const name = (member.property as AST.Identifier).name;
        this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(name));
      }
      // Stack: obj, key
      // Now push args
      for (const arg of expr.arguments) {
        this.compileExpression(arg);
      }
      // Stack: obj, key, arg1, arg2, ...
      // CALL_METHOD pops argc args, then key, then obj
      this.builder.emitU16(OP.CALL_METHOD, expr.arguments.length);
    } else {
      // Push function first
      if (expr.callee.type === 'Identifier') {
        const name = expr.callee.name;
        const local = this.resolveLocal(name);
        if (local) {
          this.builder.emitU16(OP.LOAD_LOCAL, local.slot);
        } else {
          this.builder.emitU16(OP.LOAD_GLOBAL, this.builder.addConst(name));
        }
      } else {
        this.compileExpression(expr.callee);
      }
      // Stack: func
      // Push args after
      for (const arg of expr.arguments) {
        this.compileExpression(arg);
      }
      // Stack: func, arg1, arg2, ...
      this.builder.emitU16(OP.CALL, expr.arguments.length);
    }
  }

  private compileCallWithSpread(expr: AST.CallExpression): void {
    // Push function first
    if (expr.callee.type === 'MemberExpression') {
      this.compileExpression(expr.callee.object);
      if (expr.callee.computed) {
        this.compileExpression(expr.callee.property);
      } else {
        this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst((expr.callee.property as AST.Identifier).name));
      }
    } else {
      this.compileExpression(expr.callee);
    }
    for (const arg of expr.arguments) {
      this.compileExpression(arg);
    }
    this.builder.emit(OP.SPREAD_ARGS);
    this.builder.emitU16(OP.SPREAD_CALL, expr.arguments.length);
  }

  private compileNew(expr: AST.NewExpression): void {
    this.compileExpression(expr.callee);
    for (const arg of expr.arguments) {
      this.compileExpression(arg);
    }
    this.builder.emitU16(OP.NEW, expr.arguments.length);
  }

  private compileMember(expr: AST.MemberExpression): void {
    this.compileExpression(expr.object);
    if (expr.computed) {
      this.compileExpression(expr.property);
      this.builder.emit(OP.COMPUTED_GET);
    } else {
      const name = (expr.property as AST.Identifier).name;
      this.builder.emitU16(OP.PROP_GET_NAME, this.builder.addConst(name));
    }
  }

  private compileArray(expr: AST.ArrayExpression): void {
    for (const el of expr.elements) {
      if (!el) {
        this.builder.emit(OP.PUSH_UNDEFINED);
      } else if (el.type === 'SpreadElement') {
        this.compileExpression(el.argument);
        this.builder.emit(OP.SPREAD_ARRAY);
      } else {
        this.compileExpression(el);
      }
    }
    this.builder.emitU16(OP.ARRAY_CREATE, expr.elements.length);
  }

  private compileObject(expr: AST.ObjectExpression): void {
    for (const prop of expr.properties) {
      if (prop.type === 'SpreadElement') {
        this.compileExpression(prop.argument);
        continue;
      }
      // key
      if (prop.computed) {
        this.compileExpression(prop.key);
      } else {
        const keyName = prop.key.type === 'Identifier' ? prop.key.name : String((prop.key as AST.Literal).value);
        this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(keyName));
      }
      // value
      if (prop.method && prop.value.type === 'FunctionExpression') {
        this.compileFunctionExpr(prop.value);
      } else if (prop.kind === 'get' || prop.kind === 'set') {
        this.compileFunctionExpr(prop.value);
      } else {
        this.compileExpression(prop.value);
      }
    }
    this.builder.emitU16(OP.OBJECT_CREATE, expr.properties.filter(p => p.type !== 'SpreadElement').length);
  }

  private compileSequence(expr: AST.SequenceExpression): void {
    for (let i = 0; i < expr.expressions.length; i++) {
      this.compileExpression(expr.expressions[i]!);
      if (i < expr.expressions.length - 1) {
        this.builder.emit(OP.POP);
      }
    }
  }

  private compileTemplateLiteral(expr: AST.TemplateLiteral): void {
    for (let i = 0; i < expr.quasis.length; i++) {
      this.builder.emitU16(OP.PUSH_CONST, this.builder.addConst(expr.quasis[i]!.value));
      if (i < expr.expressions.length) {
        this.compileExpression(expr.expressions[i]!);
        this.builder.emit(OP.ADD);
      }
    }
  }

  // ── Scope helpers ────────────────────────────────────────────────────────

  private pushScope(): void {
    this.scopes.push(new Map());
    this.depth++;
  }

  private popScope(): void {
    this.scopes.pop();
    this.depth--;
  }

  private declareLocal(name: string, kind: 'var' | 'let' | 'const'): void {
    const scope = this.scopes[this.scopes.length - 1]!;
    if (scope.has(name)) return; // redeclaration
    const slot = this.nextSlot++;
    const v: VarSlot = { name, slot, depth: this.depth, kind };
    scope.set(name, v);
    this.locals.push(v);
  }

  private allocateLocal(name: string): number {
    const slot = this.nextSlot++;
    return slot;
  }

  private freeLocal(): void {
    this.nextSlot--;
  }

  private resolveLocal(name: string): VarSlot | null {
    // Walk scopes from innermost to outermost
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const slot = this.scopes[i]!.get(name);
      if (slot) return slot;
    }
    return null;
  }

  private pushLoop(loopStart: number, exitJumpPos: number): void {
    this.loopStack.push({ loopStart, continueTargets: [], breakTargets: [] });
  }

  private popLoop(loopStart: number): void {
    const ctx = this.loopStack.pop()!;
    // Patch continue targets to jump to loopStart
    for (const ct of ctx.continueTargets) {
      this.builder.patchJumpTo(ct.patchPos, loopStart);
    }
    // Patch break targets
    for (const bt of ctx.breakTargets) {
      this.builder.patchJump(bt.patchPos);
    }
  }

  private patchBreaks(): void {
    // Patch all break targets in current scope
    while (this.breakStack.length > 0) {
      const bt = this.breakStack[this.breakStack.length - 1]!;
      this.builder.patchJump(bt.patchPos);
      this.breakStack.pop();
    }
  }
}
