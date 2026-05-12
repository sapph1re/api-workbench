import { CollectionResult, RequestResult } from './runner';

export interface AgentRequestReport {
  name: string;
  verdict: 'PASS' | 'FAIL';
  method: string;
  url: string;
  status: number;
  duration_ms: number;
  size_bytes: number;
  assertions_passed: number;
  assertions_total: number;
  error: string | null;
  failures: Array<{
    assertion: string;
    expected: string;
    actual: string;
  }>;
  response_body: string | null;
  request_headers: Record<string, string> | null;
  request_body: string | null;
}

export interface AgentReport {
  schema: 'api-workbench-agent-report-v1';
  verdict: 'PASS' | 'FAIL';
  collection: string;
  source_file: string | null;
  environment: string;
  timestamp: string;
  duration_ms: number;
  summary: string;
  requests: AgentRequestReport[];
  action_items: string[];
}

export function generateAgentReport(
  result: CollectionResult,
  sourceFile?: string,
): AgentReport {
  const allPassed = result.failedRequests === 0;

  const requests: AgentRequestReport[] = result.results.map(r =>
    formatRequestForAgent(r, allPassed),
  );

  return {
    schema: 'api-workbench-agent-report-v1',
    verdict: allPassed ? 'PASS' : 'FAIL',
    collection: result.name,
    source_file: sourceFile || null,
    environment: result.environment,
    timestamp: result.timestamp,
    duration_ms: result.totalDurationMs,
    summary: `${result.passedRequests}/${result.totalRequests} requests passed, ${result.passedAssertions}/${result.totalAssertions} assertions passed`,
    requests,
    action_items: buildActionItems(result.results),
  };
}

function formatRequestForAgent(r: RequestResult, collectionPassed: boolean): AgentRequestReport {
  const passed = r.passed;
  const assertionsPassed = r.assertionResults.filter(a => a.passed).length;
  const failures = r.assertionResults
    .filter(a => !a.passed)
    .map(a => ({
      assertion: `${a.assertion.type}${a.assertion.target ? ' ' + a.assertion.target : ''} ${a.assertion.operator} ${a.assertion.expected}`,
      expected: a.assertion.expected,
      actual: a.actual,
    }));

  return {
    name: r.request.name,
    verdict: passed ? 'PASS' : 'FAIL',
    method: r.response.request.method,
    url: r.response.request.url,
    status: r.response.status,
    duration_ms: r.response.timing.durationMs,
    size_bytes: r.response.size.totalBytes,
    assertions_passed: assertionsPassed,
    assertions_total: r.assertionResults.length,
    error: r.response.error || null,
    failures,
    response_body: passed ? null : truncateBody(r.response.body),
    request_headers: passed ? null : r.response.request.headers,
    request_body: passed ? null : (r.response.request.body || null),
  };
}

function truncateBody(body: string): string | null {
  if (!body) return null;
  if (body.length <= 4000) return body;
  return body.slice(0, 4000) + '\n... (truncated)';
}

function buildActionItems(results: RequestResult[]): string[] {
  const items: string[] = [];

  for (const r of results) {
    if (r.passed) continue;

    if (r.response.error) {
      items.push(`${r.request.name}: ${r.response.error}`);
      continue;
    }

    const failedAssertions = r.assertionResults.filter(a => !a.passed);
    if (failedAssertions.length > 0) {
      for (const a of failedAssertions) {
        items.push(
          `${r.response.request.method} ${r.response.request.url} — ${a.message}`,
        );
      }
    } else if (r.response.status >= 400) {
      items.push(
        `${r.response.request.method} ${r.response.request.url} — returned ${r.response.status} ${r.response.statusText}`,
      );
    }
  }

  return items;
}
