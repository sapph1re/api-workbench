import * as assert from 'assert';
import * as http from 'http';
import { runCollection } from '../../runner';
import { ParsedRequest } from '../../parser';

function makeRequest(overrides: Partial<ParsedRequest> = {}): ParsedRequest {
  return {
    name: 'Test Request',
    method: 'GET',
    url: 'http://localhost:0',
    headers: {},
    body: '',
    line: 0,
    variables: {},
    assertionLines: [],
    ...overrides,
  };
}

describe('Runner', () => {
  let server: http.Server;
  let port: number;

  before((done) => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.url === '/ok') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"status":"ok","count":5}');
        } else if (req.url === '/created') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end('{"id":1,"created":true}');
        } else if (req.url === '/error') {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        } else if (req.url === '/echo') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Custom': 'test-value',
          });
          res.end(JSON.stringify({ method: req.method, body, headers: req.headers }));
        } else {
          res.writeHead(200);
          res.end('OK');
        }
      });
    });

    server.listen(0, () => {
      port = (server.address() as any).port;
      done();
    });
  });

  after((done) => {
    server.close(done);
  });

  it('should run a collection with no assertions', async () => {
    const result = await runCollection('test', [
      makeRequest({ url: `http://localhost:${port}/ok`, line: 0 }),
      makeRequest({ url: `http://localhost:${port}/created`, line: 5 }),
    ], {});

    assert.strictEqual(result.totalRequests, 2);
    assert.strictEqual(result.passedRequests, 2);
    assert.strictEqual(result.failedRequests, 0);
    assert.strictEqual(result.totalAssertions, 0);
  });

  it('should pass assertions that match', async () => {
    const result = await runCollection('test', [
      makeRequest({
        url: `http://localhost:${port}/ok`,
        line: 0,
        assertionLines: [
          { text: '# @assert status == 200', line: 1 },
          { text: '# @assert body contains "ok"', line: 2 },
          { text: '# @assert jsonpath $.count == 5', line: 3 },
        ],
      }),
    ], {});

    assert.strictEqual(result.totalRequests, 1);
    assert.strictEqual(result.passedRequests, 1);
    assert.strictEqual(result.failedRequests, 0);
    assert.strictEqual(result.totalAssertions, 3);
    assert.strictEqual(result.passedAssertions, 3);
    assert.strictEqual(result.failedAssertions, 0);
  });

  it('should fail assertions that do not match', async () => {
    const result = await runCollection('test', [
      makeRequest({
        url: `http://localhost:${port}/error`,
        line: 0,
        assertionLines: [
          { text: '# @assert status == 200', line: 1 },
        ],
      }),
    ], {});

    assert.strictEqual(result.passedRequests, 0);
    assert.strictEqual(result.failedRequests, 1);
    assert.strictEqual(result.failedAssertions, 1);
    assert.strictEqual(result.results[0].passed, false);
    assert.strictEqual(result.results[0].assertionResults[0].actual, '500');
  });

  it('should handle mixed pass/fail in a collection', async () => {
    const result = await runCollection('test', [
      makeRequest({
        name: 'Pass',
        url: `http://localhost:${port}/ok`,
        line: 0,
        assertionLines: [{ text: '# @assert status == 200', line: 1 }],
      }),
      makeRequest({
        name: 'Fail',
        url: `http://localhost:${port}/error`,
        line: 5,
        assertionLines: [{ text: '# @assert status == 200', line: 6 }],
      }),
    ], {});

    assert.strictEqual(result.passedRequests, 1);
    assert.strictEqual(result.failedRequests, 1);
    assert.strictEqual(result.results[0].passed, true);
    assert.strictEqual(result.results[1].passed, false);
  });

  it('should test header assertions', async () => {
    const result = await runCollection('test', [
      makeRequest({
        url: `http://localhost:${port}/echo`,
        line: 0,
        assertionLines: [
          { text: '# @assert header x-custom == "test-value"', line: 1 },
          { text: '# @assert header content-type contains "application/json"', line: 2 },
        ],
      }),
    ], {});

    assert.strictEqual(result.passedAssertions, 2);
    assert.strictEqual(result.failedAssertions, 0);
  });

  it('should test duration assertions', async () => {
    const result = await runCollection('test', [
      makeRequest({
        url: `http://localhost:${port}/ok`,
        line: 0,
        assertionLines: [
          { text: '# @assert duration < 30000', line: 1 },
        ],
      }),
    ], {});

    assert.strictEqual(result.passedAssertions, 1);
  });

  it('should report correct collection metadata', async () => {
    const result = await runCollection('my-collection', [
      makeRequest({ url: `http://localhost:${port}/ok`, line: 0 }),
    ], { API_KEY: 'test' });

    assert.strictEqual(result.name, 'my-collection');
    assert.strictEqual(result.environment, 'active');
    assert.ok(result.timestamp);
    assert.ok(result.totalDurationMs >= 0);
  });

  it('should report "none" environment when no env vars', async () => {
    const result = await runCollection('test', [
      makeRequest({ url: `http://localhost:${port}/ok`, line: 0 }),
    ], {});

    assert.strictEqual(result.environment, 'none');
  });

  it('should call onProgress callback', async () => {
    const progress: number[] = [];
    await runCollection('test', [
      makeRequest({ url: `http://localhost:${port}/ok`, line: 0 }),
      makeRequest({ url: `http://localhost:${port}/ok`, line: 5 }),
    ], {}, {}, (index) => { progress.push(index); });

    assert.deepStrictEqual(progress, [0, 1]);
  });

  it('should stop on cancellation', async () => {
    let count = 0;
    const result = await runCollection('test', [
      makeRequest({ url: `http://localhost:${port}/ok`, line: 0 }),
      makeRequest({ url: `http://localhost:${port}/ok`, line: 5 }),
      makeRequest({ url: `http://localhost:${port}/ok`, line: 10 }),
    ], {}, {}, () => { count++; }, () => count >= 2);

    assert.strictEqual(result.totalRequests, 2);
  });

  it('should handle connection errors gracefully', async () => {
    const result = await runCollection('test', [
      makeRequest({
        url: 'http://localhost:1',
        line: 0,
        assertionLines: [{ text: '# @assert status == 200', line: 1 }],
      }),
    ], {});

    assert.strictEqual(result.failedRequests, 1);
    assert.ok(result.results[0].response.error);
  });

  it('should handle body !contains assertion', async () => {
    const result = await runCollection('test', [
      makeRequest({
        url: `http://localhost:${port}/ok`,
        line: 0,
        assertionLines: [
          { text: '# @assert body !contains "error"', line: 1 },
        ],
      }),
    ], {});

    assert.strictEqual(result.passedAssertions, 1);
  });

  it('should handle jsonpath boolean assertion', async () => {
    const result = await runCollection('test', [
      makeRequest({
        url: `http://localhost:${port}/created`,
        line: 0,
        assertionLines: [
          { text: '# @assert jsonpath $.created == true', line: 1 },
          { text: '# @assert jsonpath $.id == 1', line: 2 },
        ],
      }),
    ], {});

    assert.strictEqual(result.passedAssertions, 2);
  });
});
