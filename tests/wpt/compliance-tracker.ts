/**
 * @file tests/wpt/compliance-tracker.ts
 *
 * Compliance tracking system for WPT and spec tests.
 * Generates reports on test coverage and spec compliance.
 */

export interface ComplianceReport {
  readonly date: string;
  readonly totalTests: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly complianceRate: number;
  readonly categories: CategoryReport[];
}

export interface CategoryReport {
  readonly name: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly complianceRate: number;
  readonly features: FeatureReport[];
}

export interface FeatureReport {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'partial' | 'skip';
  readonly tests: number;
  readonly passed: number;
  readonly notes?: string;
}

/**
 * Generate a compliance report from test results.
 */
export function generateComplianceReport(
  results: Array<{
    category: string;
    feature: string;
    passed: boolean;
    skipped?: boolean;
  }>
): ComplianceReport {
  const categoryMap = new Map<string, Map<string, { passed: number; total: number; skipped: number }>>();

  for (const result of results) {
    if (!categoryMap.has(result.category)) {
      categoryMap.set(result.category, new Map());
    }
    const features = categoryMap.get(result.category)!;
    if (!features.has(result.feature)) {
      features.set(result.feature, { passed: 0, total: 0, skipped: 0 });
    }
    const feature = features.get(result.feature)!;
    feature.total++;
    if (result.skipped) {
      feature.skipped++;
    } else if (result.passed) {
      feature.passed++;
    }
  }

  const categories: CategoryReport[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const [catName, features] of categoryMap) {
    const featureReports: FeatureReport[] = [];
    let catPassed = 0;
    let catTotal = 0;
    let catSkipped = 0;

    for (const [featName, stats] of features) {
      const failed = stats.total - stats.passed - stats.skipped;
      featureReports.push({
        name: featName,
        status: stats.passed === stats.total ? 'pass' :
                stats.passed === 0 ? 'fail' : 'partial',
        tests: stats.total,
        passed: stats.passed,
      });
      catPassed += stats.passed;
      catTotal += stats.total;
      catSkipped += stats.skipped;
    }

    const catFailed = catTotal - catPassed - catSkipped;
    categories.push({
      name: catName,
      total: catTotal,
      passed: catPassed,
      failed: catFailed,
      skipped: catSkipped,
      complianceRate: catTotal > 0 ? Math.round((catPassed / (catTotal - catSkipped)) * 100) : 0,
      features: featureReports,
    });

    totalPassed += catPassed;
    totalFailed += catFailed;
    totalSkipped += catSkipped;
  }

  const totalTests = totalPassed + totalFailed + totalSkipped;

  return {
    date: new Date().toISOString().split('T')[0],
    totalTests,
    passed: totalPassed,
    failed: totalFailed,
    skipped: totalSkipped,
    complianceRate: totalTests > 0 ? Math.round((totalPassed / (totalTests - totalSkipped)) * 100) : 0,
    categories,
  };
}

/**
 * Generate a markdown report from a compliance report.
 */
export function generateMarkdownReport(report: ComplianceReport): string {
  const lines: string[] = [];
  lines.push(`# Nova Browser — Spec Compliance Report`);
  lines.push(`**Date:** ${report.date}`);
  lines.push(`**Total Tests:** ${report.totalTests}`);
  lines.push(`**Passed:** ${report.passed}`);
  lines.push(`**Failed:** ${report.failed}`);
  lines.push(`**Skipped:** ${report.skipped}`);
  lines.push(`**Compliance Rate:** ${report.complianceRate}%`);
  lines.push('');
  lines.push('## Categories');
  lines.push('');
  lines.push('| Category | Tests | Passed | Failed | Compliance |');
  lines.push('|----------|-------|--------|--------|------------|');

  for (const cat of report.categories) {
    lines.push(`| ${cat.name} | ${cat.total} | ${cat.passed} | ${cat.failed} | ${cat.complianceRate}% |`);
  }

  lines.push('');
  lines.push('## Detailed Results');
  lines.push('');

  for (const cat of report.categories) {
    lines.push(`### ${cat.name} (${cat.complianceRate}%)`);
    lines.push('');
    lines.push('| Feature | Status | Tests |');
    lines.push('|---------|--------|-------|');
    for (const feat of cat.features) {
      const icon = feat.status === 'pass' ? '✅' : feat.status === 'fail' ? '❌' : '⚠️';
      lines.push(`| ${feat.name} | ${icon} ${feat.status} | ${feat.passed}/${feat.tests} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
