import { HttpResponse } from './executor';

export interface Assertion {
  type: 'status' | 'body' | 'header' | 'jsonpath' | 'duration';
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | '!contains';
  target?: string;
  expected: string;
  line: number;
  raw: string;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual: string;
  message: string;
}

export function parseAssertionLine(text: string, lineNumber: number): Assertion | null {
  const match = text.trim().match(/^#\s*@assert\s+(.+)$/i);
  if (!match) return null;

  const expr = match[1].trim();

  const statusMatch = expr.match(/^status\s+(==|!=|>=?|<=?)\s+(\d+)$/);
  if (statusMatch) {
    return { type: 'status', operator: statusMatch[1] as Assertion['operator'], expected: statusMatch[2], line: lineNumber, raw: text.trim() };
  }

  const bodyMatch = expr.match(/^body\s+(!?contains)\s+"([^"]*)"$/);
  if (bodyMatch) {
    return { type: 'body', operator: bodyMatch[1] as Assertion['operator'], expected: bodyMatch[2], line: lineNumber, raw: text.trim() };
  }

  const headerMatch = expr.match(/^header\s+([\w-]+)\s+(==|!=|contains|!contains)\s+"([^"]*)"$/);
  if (headerMatch) {
    return { type: 'header', operator: headerMatch[2] as Assertion['operator'], target: headerMatch[1].toLowerCase(), expected: headerMatch[3], line: lineNumber, raw: text.trim() };
  }

  const jsonpathMatch = expr.match(/^jsonpath\s+(\S+)\s+(==|!=|>=?|<=?|contains|!contains)\s+(.+)$/);
  if (jsonpathMatch) {
    return { type: 'jsonpath', operator: jsonpathMatch[2] as Assertion['operator'], target: jsonpathMatch[1], expected: jsonpathMatch[3].trim(), line: lineNumber, raw: text.trim() };
  }

  const durationMatch = expr.match(/^duration\s+(==|!=|>=?|<=?)\s+(\d+)$/);
  if (durationMatch) {
    return { type: 'duration', operator: durationMatch[1] as Assertion['operator'], expected: durationMatch[2], line: lineNumber, raw: text.trim() };
  }

  return null;
}

export function evaluateAssertions(response: HttpResponse, assertions: Assertion[]): AssertionResult[] {
  return assertions.map(a => evaluateAssertion(response, a));
}

function evaluateAssertion(response: HttpResponse, assertion: Assertion): AssertionResult {
  switch (assertion.type) {
    case 'status':
      return compareNumeric(response.status, assertion, 'status');
    case 'duration':
      return compareNumeric(response.timing.durationMs, assertion, 'duration');
    case 'body':
      return compareString(response.body, assertion, 'body');
    case 'header': {
      const val = response.headers[assertion.target!] || '';
      return compareString(val, assertion, `header[${assertion.target}]`);
    }
    case 'jsonpath':
      return evaluateJsonPath(response.body, assertion);
    default:
      return { assertion, passed: false, actual: '', message: `Unknown assertion type: ${(assertion as Assertion).type}` };
  }
}

function compareNumeric(actual: number, assertion: Assertion, label: string): AssertionResult {
  const expected = parseFloat(assertion.expected);
  let passed = false;
  switch (assertion.operator) {
    case '==': passed = actual === expected; break;
    case '!=': passed = actual !== expected; break;
    case '>': passed = actual > expected; break;
    case '<': passed = actual < expected; break;
    case '>=': passed = actual >= expected; break;
    case '<=': passed = actual <= expected; break;
  }
  const actualStr = String(actual);
  return {
    assertion, passed, actual: actualStr,
    message: passed
      ? `${label} ${assertion.operator} ${assertion.expected}`
      : `Expected ${label} ${assertion.operator} ${assertion.expected}, got ${actualStr}`,
  };
}

function compareString(actual: string, assertion: Assertion, label: string): AssertionResult {
  let passed = false;
  switch (assertion.operator) {
    case '==': passed = actual === assertion.expected; break;
    case '!=': passed = actual !== assertion.expected; break;
    case 'contains': passed = actual.includes(assertion.expected); break;
    case '!contains': passed = !actual.includes(assertion.expected); break;
  }
  const display = actual.length > 100 ? actual.slice(0, 100) + '...' : actual;
  return {
    assertion, passed, actual: display,
    message: passed
      ? `${label} ${assertion.operator} "${assertion.expected}"`
      : `Expected ${label} ${assertion.operator} "${assertion.expected}", got "${display}"`,
  };
}

function evaluateJsonPath(body: string, assertion: Assertion): AssertionResult {
  try {
    const json = JSON.parse(body);
    const actual = resolveJsonPath(json, assertion.target!);
    if (actual === undefined) {
      return { assertion, passed: false, actual: 'undefined', message: `JSON path ${assertion.target} not found` };
    }
    const actualStr = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);

    const numActual = Number(actual);
    const numExpected = Number(assertion.expected);
    if (!isNaN(numActual) && !isNaN(numExpected) && assertion.expected !== '' && assertion.expected !== 'true' && assertion.expected !== 'false') {
      return compareNumeric(numActual, assertion, `jsonpath(${assertion.target})`);
    }

    let expected = assertion.expected;
    if ((expected.startsWith('"') && expected.endsWith('"')) || (expected.startsWith("'") && expected.endsWith("'"))) {
      expected = expected.slice(1, -1);
    }

    if (expected === 'true' || expected === 'false' || expected === 'null') {
      const expectedVal = expected === 'true' ? true : expected === 'false' ? false : null;
      const passed = actual === expectedVal;
      return {
        assertion, passed, actual: actualStr,
        message: passed
          ? `jsonpath(${assertion.target}) ${assertion.operator} ${expected}`
          : `Expected jsonpath(${assertion.target}) ${assertion.operator} ${expected}, got ${actualStr}`,
      };
    }

    return compareString(actualStr, { ...assertion, expected }, `jsonpath(${assertion.target})`);
  } catch {
    return { assertion, passed: false, actual: 'parse error', message: 'Failed to parse response body as JSON' };
  }
}

export function resolveJsonPath(obj: any, path: string): any {
  const normalized = path.replace(/^\$\.?/, '');
  if (!normalized) return obj;
  const parts = normalized.split(/\.(?![^[]*\])|(?=\[)/);
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    if (!part) continue;
    const indexMatch = part.match(/^\[(\d+)\]$/);
    if (indexMatch) {
      current = current[parseInt(indexMatch[1])];
    } else if (part === 'length' && Array.isArray(current)) {
      current = current.length;
    } else {
      current = current[part];
    }
  }
  return current;
}
