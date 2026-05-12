import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { ParsedRequest, resolveVariables } from './parser';

export interface HttpResponse {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timing: {
    startTime: number;
    endTime: number;
    durationMs: number;
  };
  size: {
    headerBytes: number;
    bodyBytes: number;
    totalBytes: number;
  };
  error?: string;
}

export interface ExecutorOptions {
  timeout: number;
  followRedirects: boolean;
  maxResponseSize: number;
}

const DEFAULT_OPTIONS: ExecutorOptions = {
  timeout: 30000,
  followRedirects: true,
  maxResponseSize: 10 * 1024 * 1024,
};

export async function executeRequest(
  parsed: ParsedRequest,
  envVars: Record<string, string>,
  options: Partial<ExecutorOptions> = {}
): Promise<HttpResponse> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const resolvedUrl = resolveVariables(parsed.url, parsed.variables, envVars);
  const resolvedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.headers)) {
    resolvedHeaders[resolveVariables(key, parsed.variables, envVars)] =
      resolveVariables(value, parsed.variables, envVars);
  }
  const resolvedBody = parsed.body ? resolveVariables(parsed.body, parsed.variables, envVars) : '';

  const startTime = Date.now();

  try {
    const result = await doRequest(
      parsed.method,
      resolvedUrl,
      resolvedHeaders,
      resolvedBody,
      opts,
      0
    );
    result.timing.startTime = startTime;
    return result;
  } catch (err: any) {
    const endTime = Date.now();
    return {
      request: {
        method: parsed.method,
        url: resolvedUrl,
        headers: resolvedHeaders,
        body: resolvedBody,
      },
      status: 0,
      statusText: 'Error',
      headers: {},
      body: '',
      timing: {
        startTime,
        endTime,
        durationMs: endTime - startTime,
      },
      size: { headerBytes: 0, bodyBytes: 0, totalBytes: 0 },
      error: err.errors?.[0]?.message || err.message || String(err),
    };
  }
}

function doRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
  options: ExecutorOptions,
  redirectCount: number
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) {
      reject(new Error('Too many redirects'));
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const reqOptions: http.RequestOptions = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { ...headers },
      timeout: options.timeout,
    };

    const hdrs = reqOptions.headers as Record<string, string | number | string[]>;
    if (body && !hdrs['Content-Length'] && !hdrs['content-length']) {
      hdrs['Content-Length'] = Buffer.byteLength(body).toString();
    }

    const startTime = Date.now();
    const req = transport.request(reqOptions, (res) => {
      if (
        options.followRedirects &&
        res.statusCode &&
        [301, 302, 303, 307, 308].includes(res.statusCode) &&
        res.headers.location
      ) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        const redirectMethod = res.statusCode === 303 ? 'GET' : method;
        const redirectBody = res.statusCode === 303 ? '' : body;
        doRequest(redirectMethod, redirectUrl, headers, redirectBody, options, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        res.resume();
        return;
      }

      const chunks: Buffer[] = [];
      let totalSize = 0;

      res.on('data', (chunk: Buffer) => {
        if (totalSize >= options.maxResponseSize) return;
        const remaining = options.maxResponseSize - totalSize;
        if (chunk.length <= remaining) {
          chunks.push(chunk);
        } else {
          chunks.push(chunk.subarray(0, remaining));
        }
        totalSize += chunk.length;
      });

      res.on('end', () => {
        const endTime = Date.now();
        const bodyBuffer = Buffer.concat(chunks);
        const bodyStr = bodyBuffer.toString('utf-8');

        const rawHeaders = res.rawHeaders || [];
        let headerSize = 0;
        for (let i = 0; i < rawHeaders.length; i += 2) {
          headerSize += (rawHeaders[i]?.length ?? 0) + (rawHeaders[i + 1]?.length ?? 0) + 4;
        }

        const responseHeaders: Record<string, string> = {};
        if (res.headers) {
          for (const [key, value] of Object.entries(res.headers)) {
            responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value || '';
          }
        }

        resolve({
          request: { method, url, headers, body },
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: responseHeaders,
          body: bodyStr,
          timing: {
            startTime,
            endTime,
            durationMs: endTime - startTime,
          },
          size: {
            headerBytes: headerSize,
            bodyBytes: bodyBuffer.length,
            totalBytes: headerSize + bodyBuffer.length,
          },
        });
      });

      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${options.timeout}ms`));
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}
