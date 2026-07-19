// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK REPORTER — Console output formatting
// ─────────────────────────────────────────────────────────────────────────────

import type { BenchmarkResult, SuiteResult } from './runner';

function fmt(n: number, decimals = 3): string {
  if (n === Infinity) return '∞';
  if (Number.isNaN(n)) return 'NaN';
  return n.toFixed(decimals);
}

function fmtOps(n: number): string {
  if (n === Infinity) return '∞';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return fmt(n, 1);
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const sign = bytes < 0 ? '-' : '+';
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${sign}${(abs / (1024 * 1024)).toFixed(2)} MB`;
  if (abs >= 1024) return `${sign}${(abs / 1024).toFixed(2)} KB`;
  return `${sign}${abs} B`;
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

export function printBenchmarkResult(r: BenchmarkResult): void {
  const name = padRight(r.name, 42);
  const ops = padLeft(fmtOps(r.opsPerSec), 10);
  const mean = padLeft(fmt(r.meanMs), 10);
  const med = padLeft(fmt(r.medianMs), 10);
  const p95 = padLeft(fmt(r.p95Ms), 10);
  const p99 = padLeft(fmt(r.p99Ms), 10);
  const min = padLeft(fmt(r.minMs), 10);
  const max = padLeft(fmt(r.maxMs), 10);
  const sd = padLeft(fmt(r.stdDevMs), 10);
  const heap = r.heapDelta !== 0 ? `  heap: ${fmtBytes(r.heapDelta)}` : '';

  console.log(
    `  ${name} ${ops}/s  mean=${mean}ms  med=${med}ms  p95=${p95}ms  p99=${p99}ms  min=${min}ms  max=${max}ms  σ=${sd}ms${heap}`,
  );
}

export function printSuiteResult(s: SuiteResult): void {
  console.log('');
  console.log(`═══ ${s.name} ═══`);
  console.log('');
  console.log(
    `  ${padRight('Benchmark', 42)} ${padLeft('Ops/s', 10)}  ${padLeft('Mean', 10)}  ${padLeft('Median', 10)}  ${padLeft('P95', 10)}  ${padLeft('P99', 10)}  ${padLeft('Min', 10)}  ${padLeft('Max', 10)}  ${padLeft('StdDev', 10)}`,
  );
  console.log('  ' + '─'.repeat(160));
  for (const b of s.benchmarks) {
    printBenchmarkResult(b);
  }
  console.log('');
  console.log(`  Suite completed in ${fmt(s.totalMs, 1)}ms`);
}

export function printSummary(suites: readonly SuiteResult[]): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   BENCHMARK SUMMARY                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const header = `  ${padRight('Benchmark', 42)} ${padLeft('Ops/s', 10)}  ${padLeft('Mean (ms)', 12)}  ${padLeft('P95 (ms)', 12)}`;
  console.log(header);
  console.log('  ' + '─'.repeat(82));

  for (const s of suites) {
    console.log(`  ${s.name}`);
    for (const b of s.benchmarks) {
      console.log(
        `    ${padRight(b.name, 40)} ${padLeft(fmtOps(b.opsPerSec), 10)}  ${padLeft(fmt(b.meanMs), 12)}  ${padLeft(fmt(b.p95Ms), 12)}`,
      );
    }
    console.log('');
  }

  const totalBenchmarks = suites.reduce((sum, s) => sum + s.benchmarks.length, 0);
  const totalTime = suites.reduce((sum, s) => sum + s.totalMs, 0);
  console.log(`  Total: ${totalBenchmarks} benchmarks in ${fmt(totalTime, 1)}ms`);
}

/** Format results as a simple Markdown table. */
export function toMarkdown(suites: readonly SuiteResult[]): string {
  const lines: string[] = [];
  lines.push('# Benchmark Results');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Benchmarks:** ${suites.reduce((s, su) => s + su.benchmarks.length, 0)}`);
  lines.push('');

  for (const s of suites) {
    lines.push(`## ${s.name}`);
    lines.push('');
    lines.push('| Benchmark | Ops/s | Mean (ms) | Median (ms) | P95 (ms) | P99 (ms) | Min (ms) | Max (ms) | StdDev (ms) | Heap Δ |');
    lines.push('|-----------|-------|-----------|-------------|----------|----------|----------|----------|-------------|--------|');
    for (const b of s.benchmarks) {
      lines.push(
        `| ${b.name} | ${fmtOps(b.opsPerSec)} | ${fmt(b.meanMs)} | ${fmt(b.medianMs)} | ${fmt(b.p95Ms)} | ${fmt(b.p99Ms)} | ${fmt(b.minMs)} | ${fmt(b.maxMs)} | ${fmt(b.stdDevMs)} | ${fmtBytes(b.heapDelta)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
