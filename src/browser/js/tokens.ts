// ─────────────────────────────────────────────────────────────────────────────
// TOKEN TYPES
// ─────────────────────────────────────────────────────────────────────────────

export enum TokenType {
  // Literals
  Number,
  String,
  True,
  False,
  Null,
  Undefined,
  NaN,
  Infinity,
  BigInt,
  RegExp,

  // Identifier
  Identifier,

  // Operators
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
  StarStar,
  PlusPlus,
  MinusMinus,
  PlusAssign,
  MinusAssign,
  StarAssign,
  SlashAssign,
  PercentAssign,
  StarStarAssign,
  Ampersand,
  Pipe,
  Caret,
  Tilde,
  AmpersandAmpersand,
  PipePipe,
  Bang,
  BangEqual,
  Equal,
  EqualEqual,
  EqualEqualEqual,
  BangEqualEqual,
  Less,
  Greater,
  LessEqual,
  GreaterEqual,
  LessLess,
  GreaterGreater,
  GreaterGreaterGreater,
  AmpersandAssign,
  PipeAssign,
  CaretAssign,
  LessLessAssign,
  GreaterGreaterAssign,
  GreaterGreaterGreaterAssign,
  QuestionDot,
  QuestionQuestion,
  QuestionQuestionAssign,
  Question,
  Colon,
  Ellipsis,
  Arrow,

  // Punctuation
  LParen,
  RParen,
  LBrace,
  RBrace,
  LBracket,
  RBracket,
  Semicolon,
  Comma,
  Dot,
  Backtick,

  // Keywords
  Var,
  Let,
  Const,
  Function,
  Return,
  If,
  Else,
  While,
  Do,
  For,
  In,
  Of,
  Switch,
  Case,
  Default,
  Break,
  Continue,
  Try,
  Catch,
  Finally,
  Throw,
  New,
  Delete,
  Typeof,
  Instanceof,
  Void,
  This,
  Class,
  Extends,
  Super,
  Import,
  Export,
  From,
  As,
  Default2,
  Static,
  Get,
  Set,
  Debugger,
  With,
  Generator,
  Await,
  Async,
  Yield,

  // Template literal parts
  TemplateHead,      // opening `...${  (raw value before first ${)
  TemplateMiddle,    // }...${  (raw value between } and next ${)
  TemplateTail,      // }...`  (raw value after last } until closing `)
  TemplateEnd,       // ...`  (raw value when no ${ in template)
  // Special
  EOF,
  Newline,
  Whitespace,
  Comment,
  Illegal,
}

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

export function tokenTypeName(tt: TokenType): string {
  switch (tt) {
    case TokenType.Number: return 'Number';
    case TokenType.String: return 'String';
    case TokenType.True: return 'true';
    case TokenType.False: return 'false';
    case TokenType.Null: return 'null';
    case TokenType.Undefined: return 'undefined';
    case TokenType.NaN: return 'NaN';
    case TokenType.Infinity: return 'Infinity';
    case TokenType.BigInt: return 'BigInt';
    case TokenType.RegExp: return 'RegExp';
    case TokenType.Identifier: return 'Identifier';
    case TokenType.Plus: return '+';
    case TokenType.Minus: return '-';
    case TokenType.Star: return '*';
    case TokenType.Slash: return '/';
    case TokenType.Percent: return '%';
    case TokenType.StarStar: return '**';
    case TokenType.PlusPlus: return '++';
    case TokenType.MinusMinus: return '--';
    case TokenType.PlusAssign: return '+=';
    case TokenType.MinusAssign: return '-=';
    case TokenType.StarAssign: return '*=';
    case TokenType.SlashAssign: return '/=';
    case TokenType.PercentAssign: return '%=';
    case TokenType.StarStarAssign: return '**=';
    case TokenType.Ampersand: return '&';
    case TokenType.Pipe: return '|';
    case TokenType.Caret: return '^';
    case TokenType.Tilde: return '~';
    case TokenType.AmpersandAmpersand: return '&&';
    case TokenType.PipePipe: return '||';
    case TokenType.Bang: return '!';
    case TokenType.BangEqual: return '!=';
    case TokenType.Equal: return '=';
    case TokenType.EqualEqual: return '==';
    case TokenType.EqualEqualEqual: return '===';
    case TokenType.BangEqualEqual: return '!==';
    case TokenType.Less: return '<';
    case TokenType.Greater: return '>';
    case TokenType.LessEqual: return '<=';
    case TokenType.GreaterEqual: return '>=';
    case TokenType.LessLess: return '<<';
    case TokenType.GreaterGreater: return '>>';
    case TokenType.GreaterGreaterGreater: return '>>>';
    case TokenType.AmpersandAssign: return '&=';
    case TokenType.PipeAssign: return '|=';
    case TokenType.CaretAssign: return '^=';
    case TokenType.LessLessAssign: return '<<=';
    case TokenType.GreaterGreaterAssign: return '>>=';
    case TokenType.GreaterGreaterGreaterAssign: return '>>>=';
    case TokenType.QuestionDot: return '?.';
    case TokenType.QuestionQuestion: return '??';
    case TokenType.QuestionQuestionAssign: return '??=';
    case TokenType.Question: return '?';
    case TokenType.Colon: return ':';
    case TokenType.Ellipsis: return '...';
    case TokenType.Arrow: return '=>';
    case TokenType.LParen: return '(';
    case TokenType.RParen: return ')';
    case TokenType.LBrace: return '{';
    case TokenType.RBrace: return '}';
    case TokenType.LBracket: return '[';
    case TokenType.RBracket: return ']';
    case TokenType.Semicolon: return ';';
    case TokenType.Comma: return ',';
    case TokenType.Dot: return '.';
    case TokenType.Backtick: return '`';
    case TokenType.Var: return 'var';
    case TokenType.Let: return 'let';
    case TokenType.Const: return 'const';
    case TokenType.Function: return 'function';
    case TokenType.Return: return 'return';
    case TokenType.If: return 'if';
    case TokenType.Else: return 'else';
    case TokenType.While: return 'while';
    case TokenType.Do: return 'do';
    case TokenType.For: return 'for';
    case TokenType.In: return 'in';
    case TokenType.Of: return 'of';
    case TokenType.Switch: return 'switch';
    case TokenType.Case: return 'case';
    case TokenType.Default: return 'default';
    case TokenType.Break: return 'break';
    case TokenType.Continue: return 'continue';
    case TokenType.Try: return 'try';
    case TokenType.Catch: return 'catch';
    case TokenType.Finally: return 'finally';
    case TokenType.Throw: return 'throw';
    case TokenType.New: return 'new';
    case TokenType.Delete: return 'delete';
    case TokenType.Typeof: return 'typeof';
    case TokenType.Instanceof: return 'instanceof';
    case TokenType.Void: return 'void';
    case TokenType.This: return 'this';
    case TokenType.Class: return 'class';
    case TokenType.Extends: return 'extends';
    case TokenType.Super: return 'super';
    case TokenType.Import: return 'import';
    case TokenType.Export: return 'export';
    case TokenType.From: return 'from';
    case TokenType.As: return 'as';
    case TokenType.Default2: return 'default';
    case TokenType.Static: return 'static';
    case TokenType.Get: return 'get';
    case TokenType.Set: return 'set';
    case TokenType.Debugger: return 'debugger';
    case TokenType.With: return 'with';
    case TokenType.Generator: return '*';
    case TokenType.Await: return 'await';
    case TokenType.Async: return 'async';
    case TokenType.Yield: return 'yield';
    case TokenType.EOF: return 'EOF';
    case TokenType.Newline: return 'Newline';
    case TokenType.Whitespace: return 'Whitespace';
    case TokenType.Comment: return 'Comment';
    case TokenType.Illegal: return 'Illegal';
  }
}

const KEYWORDS: Record<string, TokenType> = {
  'true': TokenType.True,
  'false': TokenType.False,
  'null': TokenType.Null,
  'undefined': TokenType.Undefined,
  'NaN': TokenType.NaN,
  'Infinity': TokenType.Infinity,
  'var': TokenType.Var,
  'let': TokenType.Let,
  'const': TokenType.Const,
  'function': TokenType.Function,
  'return': TokenType.Return,
  'if': TokenType.If,
  'else': TokenType.Else,
  'while': TokenType.While,
  'do': TokenType.Do,
  'for': TokenType.For,
  'in': TokenType.In,
  'of': TokenType.Of,
  'switch': TokenType.Switch,
  'case': TokenType.Case,
  'default': TokenType.Default,
  'break': TokenType.Break,
  'continue': TokenType.Continue,
  'try': TokenType.Try,
  'catch': TokenType.Catch,
  'finally': TokenType.Finally,
  'throw': TokenType.Throw,
  'new': TokenType.New,
  'delete': TokenType.Delete,
  'typeof': TokenType.Typeof,
  'instanceof': TokenType.Instanceof,
  'void': TokenType.Void,
  'this': TokenType.This,
  'class': TokenType.Class,
  'extends': TokenType.Extends,
  'super': TokenType.Super,
  'import': TokenType.Import,
  'export': TokenType.Export,
  'from': TokenType.From,
  'as': TokenType.As,
  'static': TokenType.Static,
  'get': TokenType.Get,
  'set': TokenType.Set,
  'debugger': TokenType.Debugger,
  'with': TokenType.With,
  'await': TokenType.Await,
  'async': TokenType.Async,
  'yield': TokenType.Yield,
};

export function lookupKeyword(value: string): TokenType {
  return KEYWORDS[value] ?? TokenType.Identifier;
}
