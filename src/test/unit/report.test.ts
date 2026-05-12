import * as assert from 'assert';
import { generateMarkdownReport, generateJsonReport } from '../../report';
import { CollectionResult } from '../../runner';

function makeResult(overrides: Partial<CollectionResult> = {}): CollectionResult {
  return {
    name: 'test-collection',
    timestamp: '2026-01-01T00:00:00.000Z',
    environment: 'none',
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

describe('Report', () => {
  describe('generateMarkdownReport', () => {
    it('should generate PASS header when all pass', () => {
      const md = generateMarkdownReport(makeResult({ failedRequests: 0, passedRequests: 2, totalRequests: 2 }));
      assert.ok(md.includes('# PASS'));
    });

    it('should generate FAIL header when any fail', () => {
      const md = generateMarkdownReport(makeResult({ failedRequests: 1, passedRequests: 1, totalRequests: 2 }));
      assert.ok(md.includes('# FAIL'));
    });

    it('should include summary table', () => {
      const md = generateMarkdownReport(makeResult({
        totalRequests: 3,
        passedRequests: 2,
        failedRequests: 1,
        totalAssertions: 5,
        passedAssertions: 4,
        failedAssertions: 1,
        totalDurationMs: 250,
      }));
      assert.ok(md.includes('2/3 passed'));
      assert.ok(md.includes('4/5 passed'));
      assert.ok(md.includes('250ms'));
    });

    it('should include results table', () => {
      const md = generateMarkdownReport(makeResult({
        totalRequests: 1,
        passedRequests: 1,
        failedRequests: 0,
        results: [{
          request: { name: 'Get Users', method: 'GET', url: 'http://example.com/users', headers: {}, body: '', line: 0, variables: {}, assertionLines: [] },
          response: {
            request: { method: 'GET', url: 'http://example.com/users', headers: {}, body: '' },
            status: 200, statusText: 'OK', headers: {}, body: '', timing: { startTime: 0, endTime: 50, durationMs: 50 },
            size: { headerBytes: 0, bodyBytes: 0, totalBytes: 0 },
          },
          assertionResults: [{ assertion: { type: 'status' as const, operator: '==' as const, expected: '200', line: 1, raw: '' }, passed: true, actual: '200', message: 'status == 200' }],
          passed: true,
        }],
      }));
      assert.ok(md.includes('Get Users'));
      assert.ok(md.includes('PASS'));
      assert.ok(md.includes('1/1'));
    });

    it('should include failure details', () => {
      const md = generateMarkdownReport(makeResult({
        totalRequests: 1,
        passedRequests: 0,
        failedRequests: 1,
        results: [{
          request: { name: 'Bad Request', method: 'GET', url: 'http://example.com/fail', headers: {}, body: '', line: 0, variables: {}, assertionLines: [] },
          response: {
            request: { method: 'GET', url: 'http://example.com/fail', headers: {}, body: '' },
            status: 500, statusText: 'Error', headers: {}, body: '',
            timing: { startTime: 0, endTime: 50, durationMs: 50 },
            size: { headerBytes: 0, bodyBytes: 0, totalBytes: 0 },
          },
          assertionResults: [{
            assertion: { type: 'status' as const, operator: '==' as const, expected: '200', line: 1, raw: '' },
            passed: false, actual: '500',
            message: 'Expected status == 200, got 500',
          }],
          passed: false,
        }],
      }));
      assert.ok(md.includes('## Failures'));
      assert.ok(md.includes('Bad Request'));
      assert.ok(md.includes('500'));
    });

    it('should include collection name and metadata', () => {
      const md = generateMarkdownReport(makeResult({ name: 'my-api-tests', environment: 'staging' }));
      assert.ok(md.includes('my-api-tests'));
      assert.ok(md.includes('staging'));
    });
  });

  describe('generateJsonReport', () => {
    it('should include passed flag', () => {
      const json = generateJsonReport(makeResult({ failedRequests: 0 })) as any;
      assert.strictEqual(json.passed, true);
    });

    it('should set passed=false when failures exist', () => {
      const json = generateJsonReport(makeResult({ failedRequests: 1 })) as any;
      assert.strictEqual(json.passed, false);
    });

    it('should include summary', () => {
      const json = generateJsonReport(makeResult({
        totalRequests: 3, passedRequests: 2, failedRequests: 1,
        totalAssertions: 5, passedAssertions: 4, failedAssertions: 1,
      })) as any;
      assert.strictEqual(json.summary.total_requests, 3);
      assert.strictEqual(json.summary.passed, 2);
      assert.strictEqual(json.summary.failed, 1);
      assert.strictEqual(json.summary.total_assertions, 5);
    });

    it('should include result details', () => {
      const json = generateJsonReport(makeResult({
        totalRequests: 1, passedRequests: 1,
        results: [{
          request: { name: 'Test', method: 'GET', url: 'http://example.com', headers: {}, body: '', line: 0, variables: {}, assertionLines: [] },
          response: {
            request: { method: 'GET', url: 'http://example.com', headers: {}, body: '' },
            status: 200, statusText: 'OK', headers: {}, body: '{}',
            timing: { startTime: 0, endTime: 100, durationMs: 100 },
            size: { headerBytes: 20, bodyBytes: 2, totalBytes: 22 },
          },
          assertionResults: [{
            assertion: { type: 'status' as const, operator: '==' as const, expected: '200', line: 1, raw: '' },
            passed: true, actual: '200', message: 'status == 200',
          }],
          passed: true,
        }],
      })) as any;
      assert.strictEqual(json.results.length, 1);
      assert.strictEqual(json.results[0].name, 'Test');
      assert.strictEqual(json.results[0].response.status, 200);
      assert.strictEqual(json.results[0].assertions.length, 1);
      assert.strictEqual(json.results[0].assertions[0].passed, true);
    });

    it('should include metadata', () => {
      const json = generateJsonReport(makeResult({
        name: 'my-tests', timestamp: '2026-01-01T00:00:00Z',
        environment: 'production', totalDurationMs: 500,
      })) as any;
      assert.strictEqual(json.name, 'my-tests');
      assert.strictEqual(json.environment, 'production');
      assert.strictEqual(json.duration_ms, 500);
    });
  });
});
