import * as assert from 'assert';
import * as http from 'http';
import { executeRequest } from '../../executor';
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
    ...overrides,
  };
}

describe('Executor', () => {
  let server: http.Server;
  let port: number;

  before((done) => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const route = `${req.method} ${req.url}`;

        if (route === 'GET /echo') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            method: req.method,
            url: req.url,
            headers: req.headers,
          }));
        } else if (route === 'POST /echo') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            method: req.method,
            body: body,
            contentType: req.headers['content-type'],
          }));
        } else if (req.url === '/status/404') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else if (req.url === '/status/500') {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        } else if (req.url === '/redirect') {
          res.writeHead(302, { 'Location': `http://localhost:${port}/echo` });
          res.end();
        } else if (req.url === '/slow') {
          setTimeout(() => {
            res.writeHead(200);
            res.end('slow response');
          }, 200);
        } else if (req.url === '/headers') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Custom': 'test-value',
            'X-Request-Id': '12345',
          });
          res.end('{"ok":true}');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
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

  it('should execute a simple GET request', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/echo` }),
      {}
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.error, undefined);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.method, 'GET');
  });

  it('should execute a POST request with body', async () => {
    const response = await executeRequest(
      makeRequest({
        method: 'POST',
        url: `http://localhost:${port}/echo`,
        headers: { 'Content-Type': 'application/json' },
        body: '{"key":"value"}',
      }),
      {}
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.method, 'POST');
    assert.strictEqual(body.body, '{"key":"value"}');
  });

  it('should handle 404 responses', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/status/404` }),
      {}
    );
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body, 'Not Found');
  });

  it('should handle 500 responses', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/status/500` }),
      {}
    );
    assert.strictEqual(response.status, 500);
  });

  it('should follow redirects', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/redirect` }),
      {},
      { followRedirects: true }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.method, 'GET');
  });

  it('should not follow redirects when disabled', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/redirect` }),
      {},
      { followRedirects: false }
    );
    assert.strictEqual(response.status, 302);
  });

  it('should handle connection errors', async () => {
    const response = await executeRequest(
      makeRequest({ url: 'http://localhost:1' }),
      {}
    );
    assert.strictEqual(response.status, 0);
    assert.ok(response.error);
  });

  it('should handle timeout', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/slow` }),
      {},
      { timeout: 50 }
    );
    assert.strictEqual(response.status, 0);
    assert.ok(response.error);
    assert.ok(response.error!.includes('timed out'));
  });

  it('should capture response headers', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/headers` }),
      {}
    );
    assert.strictEqual(response.headers['x-custom'], 'test-value');
    assert.strictEqual(response.headers['x-request-id'], '12345');
  });

  it('should measure timing', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/echo` }),
      {}
    );
    assert.ok(response.timing.durationMs >= 0);
    assert.ok(response.timing.startTime > 0);
    assert.ok(response.timing.endTime >= response.timing.startTime);
  });

  it('should measure response size', async () => {
    const response = await executeRequest(
      makeRequest({ url: `http://localhost:${port}/echo` }),
      {}
    );
    assert.ok(response.size.bodyBytes > 0);
    assert.ok(response.size.totalBytes > 0);
  });

  it('should resolve variables in URL', async () => {
    const response = await executeRequest(
      makeRequest({
        url: '{{baseUrl}}/echo',
        variables: { baseUrl: `http://localhost:${port}` },
      }),
      {}
    );
    assert.strictEqual(response.status, 200);
  });

  it('should resolve env variables in URL', async () => {
    const response = await executeRequest(
      makeRequest({ url: '{{baseUrl}}/echo' }),
      { baseUrl: `http://localhost:${port}` }
    );
    assert.strictEqual(response.status, 200);
  });

  it('should resolve variables in headers', async () => {
    const response = await executeRequest(
      makeRequest({
        url: `http://localhost:${port}/echo`,
        headers: { 'Authorization': 'Bearer {{token}}' },
        variables: { token: 'my-secret-token' },
      }),
      {}
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.headers.authorization, 'Bearer my-secret-token');
  });

  it('should handle all HTTP methods', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await executeRequest(
        makeRequest({ method, url: `http://localhost:${port}/echo` }),
        {}
      );
      assert.strictEqual(response.status, 200, `Failed for ${method}`);
    }
  });

  it('should include request details in response', async () => {
    const response = await executeRequest(
      makeRequest({
        method: 'POST',
        url: `http://localhost:${port}/echo`,
        body: 'test body',
      }),
      {}
    );
    assert.strictEqual(response.request.method, 'POST');
    assert.strictEqual(response.request.url, `http://localhost:${port}/echo`);
    assert.strictEqual(response.request.body, 'test body');
  });

  it('should handle invalid URL', async () => {
    const response = await executeRequest(
      makeRequest({ url: 'not-a-valid-url' }),
      {}
    );
    assert.strictEqual(response.status, 0);
    assert.ok(response.error);
  });
});
