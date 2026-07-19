// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK SUITE — JS Engine (Lexer, Parser, Interpreter)
// ─────────────────────────────────────────────────────────────────────────────

import { bench, suite } from '../runner';
import { Lexer } from '../../browser/js/lexer';
import { Parser } from '../../browser/js/parser';
import { Interpreter } from '../../browser/js/interpreter';

// ─── JS fixtures ────────────────────────────────────────────────────────────

const JS_TRIVIAL = 'var x = 1;';

const JS_SMALL = `
var arr = [1, 2, 3, 4, 5];
var sum = 0;
for (var i = 0; i < arr.length; i++) {
  sum += arr[i];
}
function double(n) { return n * 2; }
var result = double(sum);
`;

const JS_MEDIUM = `
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
var fib10 = fibonacci(10);
var fib15 = fibonacci(15);

function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
var fact10 = factorial(10);

function isPrime(n) {
  if (n < 2) return false;
  for (var i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}
var primes = [];
for (var i = 2; i < 50; i++) {
  if (isPrime(i)) primes.push(i);
}
`;

const JS_COMPLEX = `
function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  var mid = Math.floor(arr.length / 2);
  var left = mergeSort(arr.slice(0, mid));
  var right = mergeSort(arr.slice(mid));
  return merge(left, right);
}
function merge(left, right) {
  var result = [];
  var i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) {
      result.push(left[i]); i++;
    } else {
      result.push(right[j]); j++;
    }
  }
  while (i < left.length) { result.push(left[i]); i++; }
  while (j < right.length) { result.push(right[j]); j++; }
  return result;
}
var data = [38, 27, 43, 3, 9, 82, 10, 25, 7, 62, 41, 15, 53, 29, 18, 44, 56, 12, 33, 67];
var sorted = mergeSort(data);

function binarySearch(arr, target) {
  var lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    var mid = Math.floor((lo + hi) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
var idx = binarySearch(sorted, 27);

var matrix = [];
for (var i = 0; i < 5; i++) {
  matrix[i] = [];
  for (var j = 0; j < 5; j++) {
    matrix[i][j] = i * 5 + j;
  }
}
function transpose(m) {
  var t = [];
  for (var i = 0; i < m.length; i++) {
    t[i] = [];
    for (var j = 0; j < m[i].length; j++) {
      t[i][j] = m[j][i];
    }
  }
  return t;
}
var t = transpose(matrix);
`;

// ─── Benchmarks ─────────────────────────────────────────────────────────────

export function jsLexerSuite() {
  return suite('JS Lexer', [
    () => {
      const src = JS_TRIVIAL;
      return bench('JS tokenize (trivial)', () => new Lexer(src).tokenize(), { iterations: 10000, warmup: 1000 });
    },
    () => {
      const src = JS_SMALL;
      return bench('JS tokenize (small)', () => new Lexer(src).tokenize(), { iterations: 5000, warmup: 500 });
    },
    () => {
      const src = JS_MEDIUM;
      return bench('JS tokenize (medium)', () => new Lexer(src).tokenize(), { iterations: 2000, warmup: 200 });
    },
    () => {
      const src = JS_COMPLEX;
      return bench('JS tokenize (complex)', () => new Lexer(src).tokenize(), { iterations: 1000, warmup: 100 });
    },
  ]);
}

export function jsParserSuite() {
  const sources = [JS_TRIVIAL, JS_SMALL, JS_MEDIUM, JS_COMPLEX];
  const names = ['trivial', 'small', 'medium', 'complex'];
  const iterations = [10000, 5000, 2000, 1000];
  const warmups = [1000, 500, 200, 100];

  return suite('JS Parser', sources.map((src, i) => {
    const tokens = new Lexer(src).tokenize();
    return () => bench(`JS parse (${names[i]})`, () => new Parser(tokens).parse(), { iterations: iterations[i], warmup: warmups[i] });
  }));
}

export function jsInterpreterSuite() {
  const interp = new Interpreter();
  const run = (src: string) => {
    const tokens = new Lexer(src).tokenize();
    const ast = new Parser(tokens).parse();
    return interp.run(ast);
  };

  return suite('JS Interpreter', [
    () => bench('JS eval (trivial)', () => run(JS_TRIVIAL), { iterations: 5000, warmup: 500 }),
    () => bench('JS eval (small)', () => run(JS_SMALL), { iterations: 3000, warmup: 300 }),
    () => bench('JS eval (medium)', () => run(JS_MEDIUM), { iterations: 1000, warmup: 100 }),
    () => bench('JS eval (complex)', () => run(JS_COMPLEX), { iterations: 500, warmup: 50 }),
  ]);
}

export function jsEngineSuites() {
  return [
    jsLexerSuite(),
    jsParserSuite(),
    jsInterpreterSuite(),
  ];
}
