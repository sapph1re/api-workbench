import { CollectionResult } from './runner';

export function generateMarkdownReport(result: CollectionResult): string {
  const lines: string[] = [];
  const allPassed = result.failedRequests === 0;

  lines.push(`# ${allPassed ? 'PASS' : 'FAIL'} — ${result.name}`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Date | ${result.timestamp} |`);
  lines.push(`| Environment | ${result.environment} |`);
  lines.push(`| Duration | ${result.totalDurationMs}ms |`);
  lines.push(`| Requests | ${result.passedRequests}/${result.totalRequests} passed |`);
  lines.push(`| Assertions | ${result.passedAssertions}/${result.totalAssertions} passed |`);
  lines.push('');

  lines.push('## Results');
  lines.push('');
  lines.push('| # | Name | Method | Status | Duration | Assertions | Result |');
  lines.push('|---|------|--------|--------|----------|------------|--------|');

  result.results.forEach((r, i) => {
    const ac = r.assertionResults.length;
    const ap = r.assertionResults.filter(a => a.passed).length;
    const assertStr = ac > 0 ? `${ap}/${ac}` : '-';
    lines.push(`| ${i + 1} | ${r.request.name} | ${r.response.request.method} | ${r.response.status} | ${r.response.timing.durationMs}ms | ${assertStr} | ${r.passed ? 'PASS' : 'FAIL'} |`);
  });
  lines.push('');

  const failures = result.results.filter(r => !r.passed);
  if (failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const r of failures) {
      lines.push(`### ${r.request.name}`);
      lines.push('');
      lines.push(`- **Request**: \`${r.response.request.method} ${r.response.request.url}\``);
      lines.push(`- **Status**: ${r.response.status} ${r.response.statusText}`);
      if (r.response.error) {
        lines.push(`- **Error**: ${r.response.error}`);
      }
      lines.push('');
      const failed = r.assertionResults.filter(a => !a.passed);
      if (failed.length > 0) {
        lines.push('| Assertion | Expected | Actual | Result |');
        lines.push('|-----------|----------|--------|--------|');
        for (const a of failed) {
          const label = a.assertion.type + (a.assertion.target ? ` ${a.assertion.target}` : '');
          lines.push(`| ${label} | ${a.assertion.operator} ${a.assertion.expected} | ${a.actual} | FAIL |`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

export function generateJsonReport(result: CollectionResult): object {
  return {
    name: result.name,
    timestamp: result.timestamp,
    environment: result.environment,
    duration_ms: result.totalDurationMs,
    passed: result.failedRequests === 0,
    summary: {
      total_requests: result.totalRequests,
      passed: result.passedRequests,
      failed: result.failedRequests,
      total_assertions: result.totalAssertions,
      assertions_passed: result.passedAssertions,
      assertions_failed: result.failedAssertions,
    },
    results: result.results.map((r, i) => ({
      index: i + 1,
      name: r.request.name,
      passed: r.passed,
      request: {
        method: r.response.request.method,
        url: r.response.request.url,
      },
      response: {
        status: r.response.status,
        status_text: r.response.statusText,
        duration_ms: r.response.timing.durationMs,
        size_bytes: r.response.size.totalBytes,
        error: r.response.error || null,
      },
      assertions: r.assertionResults.map(a => ({
        type: a.assertion.type,
        target: a.assertion.target || null,
        operator: a.assertion.operator,
        expected: a.assertion.expected,
        actual: a.actual,
        passed: a.passed,
        message: a.message,
      })),
    })),
  };
}
