import * as assert from 'assert';
import { parseHttpFile, resolveVariables } from '../../parser';

describe('Parser', () => {
  describe('parseHttpFile', () => {
    it('should parse a simple GET request', () => {
      const text = 'GET https://api.example.com/users';
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].method, 'GET');
      assert.strictEqual(requests[0].url, 'https://api.example.com/users');
      assert.strictEqual(requests[0].line, 0);
    });

    it('should parse a GET with HTTP version', () => {
      const text = 'GET https://api.example.com/users HTTP/1.1';
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].method, 'GET');
      assert.strictEqual(requests[0].url, 'https://api.example.com/users');
    });

    it('should parse request with headers', () => {
      const text = `POST https://api.example.com/users
Content-Type: application/json
Authorization: Bearer token123`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].method, 'POST');
      assert.deepStrictEqual(requests[0].headers, {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token123',
      });
    });

    it('should parse request with body', () => {
      const text = `POST https://api.example.com/users
Content-Type: application/json

{"name": "John", "email": "john@example.com"}`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].body, '{"name": "John", "email": "john@example.com"}');
    });

    it('should parse multiple requests separated by ###', () => {
      const text = `### Get Users
GET https://api.example.com/users

### Create User
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(requests[0].method, 'GET');
      assert.strictEqual(requests[0].name, 'Get Users');
      assert.strictEqual(requests[1].method, 'POST');
      assert.strictEqual(requests[1].name, 'Create User');
    });

    it('should parse file-level variables', () => {
      const text = `@host = https://api.example.com
@token = abc123

GET {{host}}/users
Authorization: Bearer {{token}}`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].variables['host'], 'https://api.example.com');
      assert.strictEqual(requests[0].variables['token'], 'abc123');
    });

    it('should handle comments', () => {
      const text = `# This is a comment
GET https://api.example.com/users
// Another comment style`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
    });

    it('should parse all HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      for (const method of methods) {
        const requests = parseHttpFile(`${method} https://example.com/test`);
        assert.strictEqual(requests.length, 1, `Failed for ${method}`);
        assert.strictEqual(requests[0].method, method);
      }
    });

    it('should parse # @name directive', () => {
      const text = `# @name myRequest
GET https://api.example.com/users`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests[0].name, 'myRequest');
    });

    it('should handle empty file', () => {
      const requests = parseHttpFile('');
      assert.strictEqual(requests.length, 0);
    });

    it('should handle file with only comments', () => {
      const requests = parseHttpFile('# just a comment\n// another comment');
      assert.strictEqual(requests.length, 0);
    });

    it('should parse multiline JSON body', () => {
      const text = `POST https://api.example.com/data
Content-Type: application/json

{
  "name": "Test",
  "value": 42,
  "nested": {
    "key": "val"
  }
}`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.ok(requests[0].body.includes('"name": "Test"'));
      assert.ok(requests[0].body.includes('"nested"'));
    });

    it('should handle request with no URL path', () => {
      const text = 'GET https://example.com';
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].url, 'https://example.com');
    });

    it('should parse URL with query parameters', () => {
      const text = 'GET https://api.example.com/search?q=test&page=1';
      const requests = parseHttpFile(text);
      assert.strictEqual(requests[0].url, 'https://api.example.com/search?q=test&page=1');
    });
  });

    it('should parse assertion lines after request', () => {
      const text = `### Test
GET https://example.com/api

# @assert status == 200
# @assert body contains "success"`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].assertionLines.length, 2);
      assert.ok(requests[0].assertionLines[0].text.includes('@assert status == 200'));
      assert.ok(requests[0].assertionLines[1].text.includes('@assert body contains'));
    });

    it('should parse assertion lines after body', () => {
      const text = `POST https://example.com/api
Content-Type: application/json

{"key":"value"}

# @assert status == 201
# @assert jsonpath $.key == "value"`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].body, '{"key":"value"}');
      assert.strictEqual(requests[0].assertionLines.length, 2);
    });

    it('should not include assertion lines in body', () => {
      const text = `GET https://example.com/api
# @assert status == 200`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests[0].body, '');
      assert.strictEqual(requests[0].assertionLines.length, 1);
    });

    it('should handle multiple requests with assertions', () => {
      const text = `### First
GET https://example.com/one
# @assert status == 200

### Second
POST https://example.com/two
# @assert status == 201`;
      const requests = parseHttpFile(text);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(requests[0].assertionLines.length, 1);
      assert.strictEqual(requests[1].assertionLines.length, 1);
    });

    it('should have empty assertionLines when no assertions', () => {
      const text = 'GET https://example.com/api';
      const requests = parseHttpFile(text);
      assert.strictEqual(requests[0].assertionLines.length, 0);
    });

  describe('resolveVariables', () => {
    it('should replace {{var}} with values', () => {
      const result = resolveVariables('Hello {{name}}', { name: 'World' }, {});
      assert.strictEqual(result, 'Hello World');
    });

    it('should leave unresolved variables as-is', () => {
      const result = resolveVariables('Hello {{unknown}}', {}, {});
      assert.strictEqual(result, 'Hello {{unknown}}');
    });

    it('should prefer file variables over env variables', () => {
      const result = resolveVariables('{{host}}', { host: 'file-host' }, { host: 'env-host' });
      assert.strictEqual(result, 'file-host');
    });

    it('should fall back to env variables', () => {
      const result = resolveVariables('{{host}}', {}, { host: 'env-host' });
      assert.strictEqual(result, 'env-host');
    });

    it('should handle multiple variables', () => {
      const result = resolveVariables('{{method}} {{host}}/{{path}}', { method: 'GET', host: 'example.com', path: 'api' }, {});
      assert.strictEqual(result, 'GET example.com/api');
    });

    it('should handle no variables', () => {
      const result = resolveVariables('plain text', {}, {});
      assert.strictEqual(result, 'plain text');
    });
  });
});
