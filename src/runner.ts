import { ParsedRequest } from './parser';
import { executeRequest, HttpResponse, ExecutorOptions } from './executor';
import { Assertion, AssertionResult, evaluateAssertions, parseAssertionLine } from './assertions';

export interface RequestResult {
  request: ParsedRequest;
  response: HttpResponse;
  assertionResults: AssertionResult[];
  passed: boolean;
}

export interface CollectionResult {
  name: string;
  timestamp: string;
  environment: string;
  results: RequestResult[];
  totalRequests: number;
  passedRequests: number;
  failedRequests: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
  totalDurationMs: number;
}

export async function runCollection(
  name: string,
  requests: ParsedRequest[],
  envVars: Record<string, string>,
  options: Partial<ExecutorOptions> = {},
  onProgress?: (index: number, total: number, request: ParsedRequest) => void,
  shouldCancel?: () => boolean,
): Promise<CollectionResult> {
  const results: RequestResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < requests.length; i++) {
    if (shouldCancel?.()) break;
    onProgress?.(i, requests.length, requests[i]);

    const response = await executeRequest(requests[i], envVars, options);

    const assertions: Assertion[] = [];
    for (const al of requests[i].assertionLines) {
      const parsed = parseAssertionLine(al.text, al.line);
      if (parsed) assertions.push(parsed);
    }

    const assertionResults = evaluateAssertions(response, assertions);
    const passed = assertionResults.length === 0 || assertionResults.every(r => r.passed);

    results.push({ request: requests[i], response, assertionResults, passed });
  }

  const totalAssertions = results.reduce((sum, r) => sum + r.assertionResults.length, 0);
  const passedAssertions = results.reduce((sum, r) => sum + r.assertionResults.filter(a => a.passed).length, 0);

  return {
    name,
    timestamp: new Date().toISOString(),
    environment: Object.keys(envVars).length > 0 ? 'active' : 'none',
    results,
    totalRequests: results.length,
    passedRequests: results.filter(r => r.passed).length,
    failedRequests: results.filter(r => !r.passed).length,
    totalAssertions,
    passedAssertions,
    failedAssertions: totalAssertions - passedAssertions,
    totalDurationMs: Date.now() - startTime,
  };
}
