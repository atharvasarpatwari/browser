// ─────────────────────────────────────────────────────────────────────────────
// AST NODE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceLocation {
  line: number;
  column: number;
}

export type Node =
  | Program
  | Expression | Statement;

// ── Expressions ──────────────────────────────────────────────────────────────

export type Expression =
  | Identifier
  | Literal
  | ThisExpression
  | ArrayExpression
  | ObjectExpression
  | FunctionExpression
  | ArrowFunctionExpression
  | UnaryExpression
  | UpdateExpression
  | BinaryExpression
  | LogicalExpression
  | AssignmentExpression
  | ConditionalExpression
  | CallExpression
  | NewExpression
  | MemberExpression
  | SequenceExpression
  | TemplateLiteral
  | TaggedTemplateExpression
  | SpreadElement
  | RestElement
  | AssignmentPattern
  | PropertyDefinition
  | SuperExpression;

export interface Identifier {
  type: 'Identifier';
  name: string;
  loc?: SourceLocation;
}

export interface Literal {
  type: 'Literal';
  value: string | number | boolean | null | bigint | RegExpLiteral;
  raw: string;
  loc?: SourceLocation;
}

export interface RegExpLiteral {
  type: 'RegExp';
  pattern: string;
  flags: string;
}

export interface ThisExpression {
  type: 'ThisExpression';
  loc?: SourceLocation;
}

export interface SuperExpression {
  type: 'SuperExpression';
  loc?: SourceLocation;
}

export interface ArrayExpression {
  type: 'ArrayExpression';
  elements: (Expression | SpreadElement | null)[];
  loc?: SourceLocation;
}

export interface ObjectExpression {
  type: 'ObjectExpression';
  properties: (PropertyDefinition | SpreadElement)[];
  loc?: SourceLocation;
}

export interface PropertyDefinition {
  type: 'PropertyDefinition';
  key: Expression;
  value: Expression | null;
  kind: 'init' | 'get' | 'set';
  computed: boolean;
  shorthand: boolean;
  method: boolean;
  loc?: SourceLocation;
}

export interface FunctionExpression {
  type: 'FunctionExpression';
  id: Identifier | null;
  params: (Identifier | RestElement | AssignmentPattern)[];
  body: BlockStatement | Expression;
  async: boolean;
  generator: boolean;
  loc?: SourceLocation;
}

export interface ArrowFunctionExpression {
  type: 'ArrowFunctionExpression';
  params: (Identifier | RestElement | AssignmentPattern)[];
  body: BlockStatement | Expression;
  async: boolean;
  expression: boolean;
  loc?: SourceLocation;
}

export interface UnaryExpression {
  type: 'UnaryExpression';
  operator: string;
  argument: Expression;
  prefix: boolean;
  loc?: SourceLocation;
}

export interface UpdateExpression {
  type: 'UpdateExpression';
  operator: string;
  argument: Expression;
  prefix: boolean;
  loc?: SourceLocation;
}

export interface BinaryExpression {
  type: 'BinaryExpression';
  operator: string;
  left: Expression;
  right: Expression;
  loc?: SourceLocation;
}

export interface LogicalExpression {
  type: 'LogicalExpression';
  operator: string;
  left: Expression;
  right: Expression;
  loc?: SourceLocation;
}

export interface AssignmentExpression {
  type: 'AssignmentExpression';
  operator: string;
  left: Expression | Identifier;
  right: Expression;
  loc?: SourceLocation;
}

export interface ConditionalExpression {
  type: 'ConditionalExpression';
  test: Expression;
  consequent: Expression;
  alternate: Expression;
  loc?: SourceLocation;
}

export interface CallExpression {
  type: 'CallExpression';
  callee: Expression;
  arguments: (Expression | SpreadElement)[];
  optional: boolean;
  loc?: SourceLocation;
}

export interface NewExpression {
  type: 'NewExpression';
  callee: Expression;
  arguments: (Expression | SpreadElement)[];
  loc?: SourceLocation;
}

export interface MemberExpression {
  type: 'MemberExpression';
  object: Expression;
  property: Expression;
  computed: boolean;
  optional: boolean;
  loc?: SourceLocation;
}

export interface SequenceExpression {
  type: 'SequenceExpression';
  expressions: Expression[];
  loc?: SourceLocation;
}

export interface TemplateLiteral {
  type: 'TemplateLiteral';
  quasis: TemplateElement[];
  expressions: Expression[];
  loc?: SourceLocation;
}

export interface TemplateElement {
  type: 'TemplateElement';
  value: string;
  tail: boolean;
}

export interface TaggedTemplateExpression {
  type: 'TaggedTemplateExpression';
  tag: Expression;
  quasi: TemplateLiteral;
  loc?: SourceLocation;
}

export interface SpreadElement {
  type: 'SpreadElement';
  argument: Expression;
  loc?: SourceLocation;
}

export interface RestElement {
  type: 'RestElement';
  argument: Identifier | AssignmentPattern | ArrayPattern | ObjectPattern;
  loc?: SourceLocation;
}

export interface AssignmentPattern {
  type: 'AssignmentPattern';
  left: Identifier | ArrayPattern | ObjectPattern;
  right: Expression;
  loc?: SourceLocation;
}

export interface ArrayPattern {
  type: 'ArrayPattern';
  elements: (Identifier | AssignmentPattern | RestElement | ArrayPattern | ObjectPattern | null)[];
  loc?: SourceLocation;
}

export interface ObjectPattern {
  type: 'ObjectPattern';
  properties: (ObjectPatternProperty | RestElement)[];
  loc?: SourceLocation;
}

export interface ObjectPatternProperty {
  type: 'Property';
  key: Expression;
  value: Identifier | AssignmentPattern | ArrayPattern | ObjectPattern;
  shorthand: boolean;
  computed: boolean;
  loc?: SourceLocation;
}

// ── Statements ───────────────────────────────────────────────────────────────

export type Statement =
  | ExpressionStatement
  | BlockStatement
  | EmptyStatement
  | ReturnStatement
  | IfStatement
  | WhileStatement
  | DoWhileStatement
  | ForStatement
  | ForInStatement
  | ForOfStatement
  | SwitchStatement
  | SwitchCase
  | TryStatement
  | CatchClause
  | ThrowStatement
  | BreakStatement
  | ContinueStatement
  | LabeledStatement
  | DebuggerStatement
  | VariableDeclaration
  | FunctionDeclaration
  | ClassDeclaration;

export interface Program {
  type: 'Program';
  body: Statement[];
  loc?: SourceLocation;
}

export interface ExpressionStatement {
  type: 'ExpressionStatement';
  expression: Expression;
  loc?: SourceLocation;
}

export interface BlockStatement {
  type: 'BlockStatement';
  body: Statement[];
  loc?: SourceLocation;
}

export interface EmptyStatement {
  type: 'EmptyStatement';
  loc?: SourceLocation;
}

export interface ReturnStatement {
  type: 'ReturnStatement';
  argument: Expression | null;
  loc?: SourceLocation;
}

export interface IfStatement {
  type: 'IfStatement';
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
  loc?: SourceLocation;
}

export interface WhileStatement {
  type: 'WhileStatement';
  test: Expression;
  body: Statement;
  loc?: SourceLocation;
}

export interface DoWhileStatement {
  type: 'DoWhileStatement';
  test: Expression;
  body: Statement;
  loc?: SourceLocation;
}

export interface ForStatement {
  type: 'ForStatement';
  init: VariableDeclaration | Expression | null;
  test: Expression | null;
  update: Expression | null;
  body: Statement;
  loc?: SourceLocation;
}

export interface ForInStatement {
  type: 'ForInStatement';
  left: VariableDeclaration | Identifier;
  right: Expression;
  body: Statement;
  loc?: SourceLocation;
}

export interface ForOfStatement {
  type: 'ForOfStatement';
  left: VariableDeclaration | Identifier;
  right: Expression;
  body: Statement;
  await: boolean;
  loc?: SourceLocation;
}

export interface SwitchStatement {
  type: 'SwitchStatement';
  discriminant: Expression;
  cases: SwitchCase[];
  loc?: SourceLocation;
}

export interface SwitchCase {
  type: 'SwitchCase';
  test: Expression | null;
  consequent: Statement[];
  loc?: SourceLocation;
}

export interface TryStatement {
  type: 'TryStatement';
  block: BlockStatement;
  handler: CatchClause | null;
  finalizer: BlockStatement | null;
  loc?: SourceLocation;
}

export interface CatchClause {
  type: 'CatchClause';
  param: Identifier | null;
  body: BlockStatement;
  loc?: SourceLocation;
}

export interface ThrowStatement {
  type: 'ThrowStatement';
  argument: Expression;
  loc?: SourceLocation;
}

export interface BreakStatement {
  type: 'BreakStatement';
  label: Identifier | null;
  loc?: SourceLocation;
}

export interface ContinueStatement {
  type: 'ContinueStatement';
  label: Identifier | null;
  loc?: SourceLocation;
}

export interface LabeledStatement {
  type: 'LabeledStatement';
  label: Identifier;
  body: Statement;
  loc?: SourceLocation;
}

export interface DebuggerStatement {
  type: 'DebuggerStatement';
  loc?: SourceLocation;
}

export interface VariableDeclaration {
  type: 'VariableDeclaration';
  declarations: VariableDeclarator[];
  kind: 'var' | 'let' | 'const';
  loc?: SourceLocation;
}

export interface VariableDeclarator {
  type: 'VariableDeclarator';
  id: Identifier | AssignmentPattern | RestElement;
  init: Expression | null;
  loc?: SourceLocation;
}

export interface FunctionDeclaration {
  type: 'FunctionDeclaration';
  id: Identifier;
  params: (Identifier | RestElement | AssignmentPattern)[];
  body: BlockStatement;
  async: boolean;
  generator: boolean;
  loc?: SourceLocation;
}

export interface ClassDeclaration {
  type: 'ClassDeclaration';
  id: Identifier | null;
  superClass: Expression | null;
  body: ClassBody;
  loc?: SourceLocation;
}

export interface ClassBody {
  type: 'ClassBody';
  body: (PropertyDefinition | MethodDefinition)[];
}

export interface MethodDefinition {
  type: 'MethodDefinition';
  key: Expression;
  value: FunctionExpression;
  kind: 'constructor' | 'method' | 'get' | 'set';
  computed: boolean;
  static: boolean;
}
