# API Workbench

**Agent-ready API testing for VS Code, Cursor, and Windsurf.**

Test HTTP APIs directly from `.http` files with structured, machine-readable output that AI coding assistants can read and act on — no browser, no cloud, no account required.

## Features

- **Execute HTTP requests** from `.http` / `.rest` files with a single click or keyboard shortcut
- **Agent-readable output** — structured text format (`REQUEST:`, `STATUS:`, `DURATION:`, `BODY_JSON:`) that AI assistants can parse directly
- **Test runner** — run all requests in a file as a test suite with pass/fail reporting and timing
- **Environment variables** — scan `.env` files, switch environments via status bar
- **Collection sidebar** — browse all `.http` files in your workspace from a tree view
- **Response webview** — rich panel with Body / Headers / Raw tabs
- **CodeLens buttons** — inline "Send Request" buttons above each request definition
- **Git-native** — collections are plain `.http` files you commit alongside your code
- **Zero cloud dependency** — everything runs locally

## Quick Start

1. Install the extension
2. Open or create a `.http` file
3. Write a request:

```http
GET https://api.github.com/repos/microsoft/vscode
Accept: application/json
```

4. Click **Send Request** in the editor toolbar (or press `Ctrl+Alt+R` / `Cmd+Alt+R`)
5. View the response in the **API Workbench** output channel — agent-readable by default

## Agent-Readable Output

Every request produces structured output that AI coding assistants can read without parsing HTML or JSON:

```
---
REQUEST: GET https://api.github.com/repos/microsoft/vscode
STATUS: 200 OK
DURATION: 312ms
SIZE: 4821 bytes
BODY_JSON: {"id":41881900,"name":"vscode","full_name":"microsoft/vscode",...}
---
```

This format is designed for AI agents: status codes, timing, and response bodies are on labeled lines — no nested UI needed.

## Environment Variables

Create `.env` files in your workspace to define environments:

```env
# .env.staging
BASE_URL=https://staging.api.example.com
API_KEY=sk-staging-abc123
```

Reference variables in requests using `{{variable}}` syntax:

```http
GET {{BASE_URL}}/users
Authorization: Bearer {{API_KEY}}
```

Switch environments from the status bar (bottom right) or via `Ctrl+Shift+P` → **API Workbench: Select Environment**.

## Test Runner

Run all requests in a file as a test suite:

1. Open a `.http` file
2. Click **Send All Requests** in the toolbar
3. Each request is executed sequentially with progress indication
4. Results appear in the output channel with pass/fail status and timing

## .http File Syntax

```http
### Get user profile
GET https://api.example.com/users/123
Authorization: Bearer {{API_KEY}}
Content-Type: application/json

###

### Create user
POST https://api.example.com/users
Content-Type: application/json

{
  "name": "Alice",
  "email": "alice@example.com"
}
```

Requests are separated by `###`. Comments start with `#`.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+R` / `Cmd+Alt+R` | Send request at cursor |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `apiWorkbench.timeout` | `30000` | Request timeout (ms) |
| `apiWorkbench.followRedirects` | `true` | Follow HTTP redirects |
| `apiWorkbench.maxResponseSize` | `10485760` | Max response body size (bytes) |

## Why API Workbench?

| | API Workbench | REST Client | Postman | Thunder Client |
|--|--|--|--|--|
| Agent-readable output | ✅ | ❌ | ❌ | ❌ |
| Works in Cursor / Windsurf | ✅ | ✅ | ❌ | ✅ |
| No account required | ✅ | ✅ | ❌ | ✅ |
| Git-native collections | ✅ | ✅ | ❌ | ❌ |
| Built-in test runner | ✅ | ❌ | ✅ | ✅ |
| Environment variables | ✅ | ✅ | ✅ | ✅ |
| Free | ✅ | ✅ | Partial | Partial |

## License

MIT
