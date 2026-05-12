import * as assert from 'assert';
import { parseAssertionLine, evaluateAssertions, Assertion, resolveJsonPath } from '../../assertions';
import { HttpResponse } from '../../executor';

function makeResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    request: { method: 'GET', url: 'http://example.com', headers: {}, body: '' },
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"name":"test","count":42,"items":[1,2,3],"active":true}',
    timing: { startTime: 0, endTime: 100, durationMs: 100 },
    size: { headerBytes: 50, bodyBytes: 55, totalBytes: 105 },
    ...overrides,
  };
}

describe('Assertions', () => {
  describe('parseAssertionLine', () => {
    it('should parse status == assertion', () => {
      const a = parseAssertionLine('# @assert status == 200', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'status');
      assert.strictEqual(a!.operator, '==');
      assert.strictEqual(a!.expected, '200');
    });

    it('should parse status != assertion', () => {
      const a = parseAssertionLine('# @assert status != 500', 5);
      assert.ok(a);
      assert.strictEqual(a!.type, 'status');
      assert.strictEqual(a!.operator, '!=');
      assert.strictEqual(a!.expected, '500');
    });

    it('should parse status >= assertion', () => {
      const a = parseAssertionLine('# @assert status >= 200', 0);
      assert.ok(a);
      assert.strictEqual(a!.operator, '>=');
    });

    it('should parse status < assertion', () => {
      const a = parseAssertionLine('# @assert status < 300', 0);
      assert.ok(a);
      assert.strictEqual(a!.operator, '<');
    });

    it('should parse body contains assertion', () => {
      const a = parseAssertionLine('# @assert body contains "success"', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'body');
      assert.strictEqual(a!.operator, 'contains');
      assert.strictEqual(a!.expected, 'success');
    });

    it('should parse body !contains assertion', () => {
      const a = parseAssertionLine('# @assert body !contains "error"', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'body');
      assert.strictEqual(a!.operator, '!contains');
      assert.strictEqual(a!.expected, 'error');
    });

    it('should parse header assertion', () => {
      const a = parseAssertionLine('# @assert header content-type contains "application/json"', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'header');
      assert.strictEqual(a!.target, 'content-type');
      assert.strictEqual(a!.operator, 'contains');
      assert.strictEqual(a!.expected, 'application/json');
    });

    it('should parse header == assertion', () => {
      const a = parseAssertionLine('# @assert header x-custom == "test-value"', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'header');
      assert.strictEqual(a!.target, 'x-custom');
      assert.strictEqual(a!.operator, '==');
    });

    it('should parse jsonpath assertion with numeric value', () => {
      const a = parseAssertionLine('# @assert jsonpath $.count == 42', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'jsonpath');
      assert.strictEqual(a!.target, '$.count');
      assert.strictEqual(a!.operator, '==');
      assert.strictEqual(a!.expected, '42');
    });

    it('should parse jsonpath assertion with string value', () => {
      const a = parseAssertionLine('# @assert jsonpath $.name == "test"', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'jsonpath');
      assert.strictEqual(a!.expected, '"test"');
    });

    it('should parse jsonpath > assertion', () => {
      const a = parseAssertionLine('# @assert jsonpath $.items.length > 0', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'jsonpath');
      assert.strictEqual(a!.target, '$.items.length');
      assert.strictEqual(a!.operator, '>');
    });

    it('should parse duration assertion', () => {
      const a = parseAssertionLine('# @assert duration < 5000', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'duration');
      assert.strictEqual(a!.operator, '<');
      assert.strictEqual(a!.expected, '5000');
    });

    it('should return null for non-assertion lines', () => {
      assert.strictEqual(parseAssertionLine('# regular comment', 0), null);
      assert.strictEqual(parseAssertionLine('GET http://example.com', 0), null);
      assert.strictEqual(parseAssertionLine('', 0), null);
    });

    it('should handle extra whitespace', () => {
      const a = parseAssertionLine('#   @assert   status   ==   200', 0);
      assert.ok(a);
      assert.strictEqual(a!.type, 'status');
    });

    it('should preserve line number', () => {
      const a = parseAssertionLine('# @assert status == 200', 42);
      assert.strictEqual(a!.line, 42);
    });
  });

  describe('evaluateAssertions', () => {
    it('should pass status == 200', () => {
      const response = makeResponse({ status: 200 });
      const assertions: Assertion[] = [{ type: 'status', operator: '==', expected: '200', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].passed, true);
    });

    it('should fail status == 200 when status is 404', () => {
      const response = makeResponse({ status: 404 });
      const assertions: Assertion[] = [{ type: 'status', operator: '==', expected: '200', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, false);
      assert.strictEqual(results[0].actual, '404');
    });

    it('should pass status != 500', () => {
      const response = makeResponse({ status: 200 });
      const assertions: Assertion[] = [{ type: 'status', operator: '!=', expected: '500', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass status >= 200', () => {
      const response = makeResponse({ status: 201 });
      const assertions: Assertion[] = [{ type: 'status', operator: '>=', expected: '200', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass status < 300', () => {
      const response = makeResponse({ status: 200 });
      const assertions: Assertion[] = [{ type: 'status', operator: '<', expected: '300', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass body contains', () => {
      const response = makeResponse({ body: '{"message":"hello world"}' });
      const assertions: Assertion[] = [{ type: 'body', operator: 'contains', expected: 'hello', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should fail body contains when not present', () => {
      const response = makeResponse({ body: '{"message":"hello"}' });
      const assertions: Assertion[] = [{ type: 'body', operator: 'contains', expected: 'goodbye', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, false);
    });

    it('should pass body !contains', () => {
      const response = makeResponse({ body: '{"ok":true}' });
      const assertions: Assertion[] = [{ type: 'body', operator: '!contains', expected: 'error', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass header contains', () => {
      const response = makeResponse({ headers: { 'content-type': 'application/json; charset=utf-8' } });
      const assertions: Assertion[] = [{ type: 'header', operator: 'contains', target: 'content-type', expected: 'application/json', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should fail header contains for missing header', () => {
      const response = makeResponse({ headers: {} });
      const assertions: Assertion[] = [{ type: 'header', operator: 'contains', target: 'x-custom', expected: 'value', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, false);
    });

    it('should pass jsonpath == numeric', () => {
      const response = makeResponse({ body: '{"count":42}' });
      const assertions: Assertion[] = [{ type: 'jsonpath', operator: '==', target: '$.count', expected: '42', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass jsonpath > numeric', () => {
      const response = makeResponse({ body: '{"count":42}' });
      const assertions: Assertion[] = [{ type: 'jsonpath', operator: '>', target: '$.count', expected: '10', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass jsonpath == string', () => {
      const response = makeResponse({ body: '{"name":"test"}' });
      const assertions: Assertion[] = [{ type: 'jsonpath', operator: '==', target: '$.name', expected: '"test"', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should fail jsonpath for missing path', () => {
      const response = makeResponse({ body: '{"name":"test"}' });
      const assertions: Assertion[] = [{ type: 'jsonpath', operator: '==', target: '$.missing', expected: '42', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, false);
      assert.ok(results[0].message.includes('not found'));
    });

    it('should fail jsonpath for invalid JSON body', () => {
      const response = makeResponse({ body: 'not json' });
      const assertions: Assertion[] = [{ type: 'jsonpath', operator: '==', target: '$.foo', expected: '1', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, false);
      assert.ok(results[0].message.includes('parse'));
    });

    it('should pass jsonpath array length', () => {
      const response = makeResponse({ body: '{"items":[1,2,3]}' });
      const assertions: Assertion[] = [{ type: 'jsonpath', operator: '==', target: '$.items.length', expected: '3', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass jsonpath array index', () => {
      const response = makeResponse({ body: '{"items":["a","b","c"]}' });
      const assertions: Assertion[] = [{ type: 'jsonpath', operator: '==', target: '$.items[0]', expected: '"a"', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass jsonpath boolean', () => {
      const response = makeResponse({ body: '{"active":true}' });
      const assertions: Assertion[] = [{ type: 'jsonpath', operator: '==', target: '$.active', expected: 'true', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should pass duration < assertion', () => {
      const response = makeResponse({ timing: { startTime: 0, endTime: 100, durationMs: 100 } });
      const assertions: Assertion[] = [{ type: 'duration', operator: '<', expected: '5000', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, true);
    });

    it('should fail duration < assertion', () => {
      const response = makeResponse({ timing: { startTime: 0, endTime: 10000, durationMs: 10000 } });
      const assertions: Assertion[] = [{ type: 'duration', operator: '<', expected: '5000', line: 0, raw: '' }];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, false);
    });

    it('should evaluate multiple assertions', () => {
      const response = makeResponse({ status: 200, body: '{"ok":true}' });
      const assertions: Assertion[] = [
        { type: 'status', operator: '==', expected: '200', line: 0, raw: '' },
        { type: 'body', operator: 'contains', expected: 'ok', line: 1, raw: '' },
        { type: 'jsonpath', operator: '==', target: '$.ok', expected: 'true', line: 2, raw: '' },
      ];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results.length, 3);
      assert.ok(results.every(r => r.passed));
    });

    it('should handle mixed pass/fail assertions', () => {
      const response = makeResponse({ status: 404, body: '{"error":"not found"}' });
      const assertions: Assertion[] = [
        { type: 'status', operator: '==', expected: '200', line: 0, raw: '' },
        { type: 'body', operator: 'contains', expected: 'not found', line: 1, raw: '' },
      ];
      const results = evaluateAssertions(response, assertions);
      assert.strictEqual(results[0].passed, false);
      assert.strictEqual(results[1].passed, true);
    });
  });

  describe('resolveJsonPath', () => {
    it('should resolve simple property', () => {
      assert.strictEqual(resolveJsonPath({ name: 'test' }, '$.name'), 'test');
    });

    it('should resolve nested property', () => {
      assert.strictEqual(resolveJsonPath({ a: { b: { c: 42 } } }, '$.a.b.c'), 42);
    });

    it('should resolve array index', () => {
      assert.strictEqual(resolveJsonPath({ items: [10, 20, 30] }, '$.items[1]'), 20);
    });

    it('should resolve array length', () => {
      assert.strictEqual(resolveJsonPath({ items: [1, 2, 3] }, '$.items.length'), 3);
    });

    it('should return undefined for missing path', () => {
      assert.strictEqual(resolveJsonPath({ a: 1 }, '$.b'), undefined);
    });

    it('should handle root $', () => {
      assert.deepStrictEqual(resolveJsonPath({ a: 1 }, '$'), { a: 1 });
    });

    it('should handle path without $. prefix', () => {
      assert.strictEqual(resolveJsonPath({ name: 'test' }, 'name'), 'test');
    });
  });
});
