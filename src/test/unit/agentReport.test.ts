import * as assert from 'assert';
import { generateAgentReport, AgentReport } from '../../agentReport';
import { CollectionResult, RequestResult } from '../../runner';

function makeResponse(overrides: any = {}): any {
  return {
    request: { method: 'GET', url: 'http://example.com', headers: {}, body: '' },
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '{"ok":true}',
    timing: { startTime: 0, endTime: 50, durationMs: 50 },
    size: { headerBytes: 40, bodyBytes: 11, totalBytes: 51 },
    ...overrides,
  };
}

function makeRequestResult(overrides: Partial<RequestResult> = {}): RequestResult {
  return {
    request: { name: 'Test Request', method: 'GET', url: 'http://example.com', headers: {}, body: '', line: 0, variables: {}, assertionLines: [] },
    response: makeResponse(),
    assertionResults: [],
    passed: true,
    ...overrides,
  };
}

function makeResult(overrides: Partial<CollectionResult> = {}): CollectionResult {
  return {
    name: 'test-collection',
    timestamp: '2026-01-01T00:00:00.000Z',
    environment: 'staging',
    results: [],
    totalRequests: 0,
    passedRequests: 0,
    failedRequests: 0,
    totalAssertions: 0,
    passedAssertions: 0,
    failedAssertions: 0,
    totalDurationMs: 100,
    ...overrides,
  };
}

describe('Agent Report', () => {
  describe('generateAgentReport', () => {
    it('should set schema version', () => {
      const report = generateAgentReport(makeResult());
      assert.strictEqual(report.schema, 'api-workbench-agent-report-v1');
    });

    it('should set PASS verdict when all requests pass', () => {
      const report = generateAgentReport(makeResult({ failedRequests: 0, passedRequests: 2, totalRequests: 2 }));
      assert.strictEqual(report.verdict, 'PASS');
    });

    it('should set FAIL verdict when any request fails', () => {
      const report = generateAgentReport(makeResult({ failedRequests: 1 }));
      assert.strictEqual(report.verdict, 'FAIL');
    });

    it('should include collection metadata', () => {
      const report = generateAgentReport(
        makeResult({ name: 'api-tests', environment: 'production', totalDurationMs: 500 }),
        '/workspace/api-tests.http',
      );
      assert.strictEqual(report.collection, 'api-tests');
      assert.strictEqual(report.source_file, '/workspace/api-tests.http');
      assert.strictEqual(report.environment, 'production');
      assert.strictEqual(report.duration_ms, 500);
    });

    it('should set source_file to null when not provided', () => {
      const report = generateAgentReport(makeResult());
      assert.strictEqual(report.source_file, null);
    });

    it('should include summary string', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 3, passedRequests: 2, failedRequests: 1,
        totalAssertions: 5, passedAssertions: 4, failedAssertions: 1,
      }));
      assert.strictEqual(report.summary, '2/3 requests passed, 4/5 assertions passed');
    });

    it('should format passing requests with flat fields', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, passedRequests: 1,
        results: [makeRequestResult({
          assertionResults: [{
            assertion: { type: 'status', operator: '==', expected: '200', line: 1, raw: '' },
            passed: true, actual: '200', message: 'status == 200',
          }],
        })],
      }));

      const req = report.requests[0];
      assert.strictEqual(req.verdict, 'PASS');
      assert.strictEqual(req.method, 'GET');
      assert.strictEqual(req.url, 'http://example.com');
      assert.strictEqual(req.status, 200);
      assert.strictEqual(req.duration_ms, 50);
      assert.strictEqual(req.size_bytes, 51);
      assert.strictEqual(req.assertions_passed, 1);
      assert.strictEqual(req.assertions_total, 1);
    });

    it('should omit response details for passing requests', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, passedRequests: 1,
        results: [makeRequestResult()],
      }));

      const req = report.requests[0];
      assert.strictEqual(req.response_body, null);
      assert.strictEqual(req.request_headers, null);
      assert.strictEqual(req.request_body, null);
    });

    it('should include response details for failing requests', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, passedRequests: 0, failedRequests: 1,
        results: [makeRequestResult({
          passed: false,
          response: makeResponse({
            request: { method: 'POST', url: 'http://example.com/users', headers: { 'Content-Type': 'application/json' }, body: '{"name":"test"}' },
            status: 500, statusText: 'Internal Server Error',
            body: '{"error":"db connection failed"}',
          }),
          assertionResults: [{
            assertion: { type: 'status', operator: '==', expected: '200', line: 1, raw: '' },
            passed: false, actual: '500', message: 'Expected status == 200, got 500',
          }],
        })],
      }));

      const req = report.requests[0];
      assert.strictEqual(req.verdict, 'FAIL');
      assert.strictEqual(req.response_body, '{"error":"db connection failed"}');
      assert.deepStrictEqual(req.request_headers, { 'Content-Type': 'application/json' });
      assert.strictEqual(req.request_body, '{"name":"test"}');
    });

    it('should include failure details', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, passedRequests: 0, failedRequests: 1,
        results: [makeRequestResult({
          passed: false,
          response: makeResponse({ status: 404, statusText: 'Not Found' }),
          assertionResults: [
            { assertion: { type: 'status', operator: '==', expected: '200', line: 1, raw: '' }, passed: false, actual: '404', message: 'Expected status == 200, got 404' },
            { assertion: { type: 'body', operator: 'contains', expected: 'users', line: 2, raw: '' }, passed: false, actual: 'not found', message: 'Expected body contains "users"' },
          ],
        })],
      }));

      const req = report.requests[0];
      assert.strictEqual(req.failures.length, 2);
      assert.strictEqual(req.failures[0].assertion, 'status == 200');
      assert.strictEqual(req.failures[0].expected, '200');
      assert.strictEqual(req.failures[0].actual, '404');
    });

    it('should build action items for failed assertions', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, passedRequests: 0, failedRequests: 1,
        results: [makeRequestResult({
          passed: false,
          response: makeResponse({ status: 500 }),
          assertionResults: [{
            assertion: { type: 'status', operator: '==', expected: '200', line: 1, raw: '' },
            passed: false, actual: '500', message: 'Expected status == 200, got 500',
          }],
        })],
      }));

      assert.strictEqual(report.action_items.length, 1);
      assert.ok(report.action_items[0].includes('GET http://example.com'));
      assert.ok(report.action_items[0].includes('Expected status == 200, got 500'));
    });

    it('should build action items for connection errors', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, passedRequests: 0, failedRequests: 1,
        results: [makeRequestResult({
          passed: false,
          response: makeResponse({ status: 0, error: 'ECONNREFUSED' }),
          assertionResults: [],
        })],
      }));

      assert.strictEqual(report.action_items.length, 1);
      assert.ok(report.action_items[0].includes('ECONNREFUSED'));
    });

    it('should have empty action_items when all pass', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 2, passedRequests: 2,
        results: [makeRequestResult(), makeRequestResult({ request: { name: 'Test 2', method: 'POST', url: 'http://example.com/post', headers: {}, body: '', line: 5, variables: {}, assertionLines: [] } })],
      }));

      assert.deepStrictEqual(report.action_items, []);
    });

    it('should truncate large response bodies', () => {
      const largeBody = 'x'.repeat(5000);
      const report = generateAgentReport(makeResult({
        totalRequests: 1, passedRequests: 0, failedRequests: 1,
        results: [makeRequestResult({
          passed: false,
          response: makeResponse({ body: largeBody }),
          assertionResults: [],
        })],
      }));

      const req = report.requests[0];
      assert.ok(req.response_body!.length <= 4020);
      assert.ok(req.response_body!.endsWith('... (truncated)'));
    });

    it('should include jsonpath assertion target in failure details', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, failedRequests: 1,
        results: [makeRequestResult({
          passed: false,
          response: makeResponse(),
          assertionResults: [{
            assertion: { type: 'jsonpath', operator: '==', target: '$.data.id', expected: '42', line: 1, raw: '' },
            passed: false, actual: '99', message: 'Expected jsonpath($.data.id) == 42, got 99',
          }],
        })],
      }));

      assert.strictEqual(report.requests[0].failures[0].assertion, 'jsonpath $.data.id == 42');
    });

    it('should set error field when response has error', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, failedRequests: 1,
        results: [makeRequestResult({
          passed: false,
          response: makeResponse({ error: 'Request timed out after 30000ms' }),
        })],
      }));

      assert.strictEqual(report.requests[0].error, 'Request timed out after 30000ms');
    });

    it('should set error to null when no error', () => {
      const report = generateAgentReport(makeResult({
        totalRequests: 1, passedRequests: 1,
        results: [makeRequestResult()],
      }));

      assert.strictEqual(report.requests[0].error, null);
    });
  });
});
