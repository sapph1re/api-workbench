import * as fs from 'fs';
import * as path from 'path';
import { parseHttpFile } from './parser';
import { executeRequest, ExecutorOptions } from './executor';
import { runCollection } from './runner';
import { generateAgentReport, AgentReport } from './agentReport';

const REPORTS_DIR = '.api-workbench/reports';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

const TOOL_DEFINITIONS = [
  {
    name: 'run_collection',
    description:
      'Run all HTTP requests in a .http/.rest file and return an agent-readable test report with pass/fail verdicts, assertion results, and action items for failures.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the .http or .rest file to run',
        },
        env_file: {
          type: 'string',
          description: 'Optional path to a .env file for variable substitution',
        },
        timeout: {
          type: 'number',
          description: 'Request timeout in milliseconds (default: 30000)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_last_results',
    description:
      'Get the most recent agent report from the .api-workbench/reports/ directory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: {
          type: 'string',
          description: 'Workspace root directory containing .api-workbench/reports/',
        },
        collection: {
          type: 'string',
          description: 'Optional collection name filter',
        },
      },
      required: ['workspace_path'],
    },
  },
];

function loadEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return vars;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

async function handleRunCollection(args: any): Promise<AgentReport> {
  const filePath = args.file_path;
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const requests = parseHttpFile(content);
  if (requests.length === 0) {
    throw new Error(`No HTTP requests found in ${filePath}`);
  }

  const envVars = args.env_file ? loadEnvFile(args.env_file) : {};
  const options: Partial<ExecutorOptions> = {};
  if (args.timeout) options.timeout = args.timeout;

  const collectionName = path.basename(filePath, path.extname(filePath));
  const result = await runCollection(collectionName, requests, envVars, options);
  const report = generateAgentReport(result, filePath);

  const dir = path.join(path.dirname(filePath), REPORTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const reportPath = path.join(dir, `${collectionName}.agent.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return report;
}

function handleGetLastResults(args: any): AgentReport {
  const reportsDir = path.join(args.workspace_path, REPORTS_DIR);
  if (!fs.existsSync(reportsDir)) {
    throw new Error(`No reports directory found at ${reportsDir}`);
  }

  const files = fs.readdirSync(reportsDir)
    .filter(f => f.endsWith('.agent.json'))
    .filter(f => !args.collection || f.startsWith(args.collection));

  if (files.length === 0) {
    throw new Error('No agent reports found');
  }

  const sorted = files
    .map(f => ({ name: f, mtime: fs.statSync(path.join(reportsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const content = fs.readFileSync(path.join(reportsDir, sorted[0].name), 'utf-8');
  return JSON.parse(content);
}

function send(msg: JsonRpcResponse): void {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

function makeResponse(id: number | string | null, result: any): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleMessage(msg: JsonRpcRequest): Promise<void> {
  switch (msg.method) {
    case 'initialize':
      send(makeResponse(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'api-workbench', version: '0.1.0' },
      }));
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      send(makeResponse(msg.id, { tools: TOOL_DEFINITIONS }));
      break;

    case 'tools/call': {
      const toolName = msg.params?.name;
      const toolArgs = msg.params?.arguments || {};
      try {
        let result: any;
        if (toolName === 'run_collection') {
          result = await handleRunCollection(toolArgs);
        } else if (toolName === 'get_last_results') {
          result = handleGetLastResults(toolArgs);
        } else {
          send(makeError(msg.id, -32601, `Unknown tool: ${toolName}`));
          return;
        }
        send(makeResponse(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }));
      } catch (err: any) {
        send(makeResponse(msg.id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        }));
      }
      break;
    }

    default:
      if (msg.id !== undefined) {
        send(makeError(msg.id, -32601, `Method not found: ${msg.method}`));
      }
  }
}

function startServer(): void {
  let buf = Buffer.alloc(0);

  process.stdin.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    processBuffer();
  });

  process.stdin.on('end', () => process.exit(0));

  function processBuffer(): void {
    while (true) {
      const headerStr = buf.toString('utf-8', 0, Math.min(buf.length, 256));
      const sepCrlf = headerStr.indexOf('\r\n\r\n');
      const sepLf = headerStr.indexOf('\n\n');
      let sepIdx: number;
      let sepLen: number;
      if (sepCrlf >= 0 && (sepLf < 0 || sepCrlf <= sepLf)) {
        sepIdx = sepCrlf; sepLen = 4;
      } else if (sepLf >= 0) {
        sepIdx = sepLf; sepLen = 2;
      } else {
        break;
      }

      const header = buf.toString('utf-8', 0, sepIdx);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { buf = buf.subarray(sepIdx + sepLen); continue; }
      const contentLen = parseInt(match[1]);
      const bodyStart = sepIdx + sepLen;
      if (buf.length - bodyStart < contentLen) break;
      const body = buf.toString('utf-8', bodyStart, bodyStart + contentLen);
      buf = buf.subarray(bodyStart + contentLen);
      try {
        handleMessage(JSON.parse(body));
      } catch {}
    }
  }
}

startServer();
