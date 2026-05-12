import * as vscode from 'vscode';

export interface ParsedRequest {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  line: number;
  variables: Record<string, string>;
}

export function parseHttpFile(text: string): ParsedRequest[] {
  const requests: ParsedRequest[] = [];
  const lines = text.split(/\r?\n/);
  const fileVariables: Record<string, string> = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith('@')) {
      const match = line.match(/^@(\w+)\s*=\s*(.*)$/);
      if (match) {
        fileVariables[match[1]] = match[2].trim();
      }
      i++;
      continue;
    }

    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      i++;
      continue;
    }

    const methodMatch = line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+(.+?)(?:\s+HTTP\/\S+)?\s*$/);
    if (methodMatch) {
      const request = parseRequest(lines, i, methodMatch[1], methodMatch[2], fileVariables);
      requests.push(request);
      i = request._endLine! + 1;
      delete (request as any)._endLine;
      continue;
    }

    i++;
  }

  return requests;
}

function parseRequest(
  lines: string[],
  startLine: number,
  method: string,
  url: string,
  fileVariables: Record<string, string>
): ParsedRequest & { _endLine?: number } {
  let name = `${method} ${url}`;
  if (startLine > 0) {
    const prevLine = lines[startLine - 1].trim();
    if (prevLine.startsWith('###')) {
      name = prevLine.replace(/^###\s*/, '') || name;
    } else if (prevLine.startsWith('# @name')) {
      name = prevLine.replace(/^# @name\s*/, '').trim() || name;
    }
  }

  const headers: Record<string, string> = {};
  let body = '';
  let i = startLine + 1;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('###')) break;
    const headerMatch = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (headerMatch) {
      headers[headerMatch[1]] = headerMatch[2].trim();
      i++;
    } else {
      break;
    }
  }

  if (i < lines.length && lines[i].trim() === '') {
    i++;
  }

  const bodyLines: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('###')) break;
    const nextMethodMatch = line.trim().match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+/);
    if (nextMethodMatch && bodyLines.length > 0) break;
    bodyLines.push(line);
    i++;
  }

  body = bodyLines.join('\n').trim();

  return {
    name,
    method,
    url,
    headers,
    body,
    line: startLine,
    variables: { ...fileVariables },
    _endLine: i - 1,
  };
}

export function resolveVariables(text: string, variables: Record<string, string>, envVars: Record<string, string>): string {
  const allVars = { ...envVars, ...variables };
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    return allVars[name] ?? match;
  });
}

export function getRequestAtCursor(document: vscode.TextDocument, position: vscode.Position): ParsedRequest | undefined {
  const requests = parseHttpFile(document.getText());
  let closest: ParsedRequest | undefined;
  for (const req of requests) {
    if (req.line <= position.line) {
      closest = req;
    }
  }
  return closest;
}
