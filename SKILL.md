---
name: nextjs-afk-sdk
description: "Transform an existing Next.js project into an agent-native application powered by agent-afk. Creates a full .afk/ project structure with TypeScript MCP servers, skills, plugins, SSE streaming, and a chat UI -- making the agent the runtime, not a bolt-on. Works with any Next.js 14+ project with App Router."
---

# Next.js + agent-afk: Agent-Native Integration

## Overview

Transform an existing Next.js application into an **agent-native** project where agent-afk is the runtime that orchestrates operations through discoverable tools. This is the generalized version of the pattern used in production by CM Dashboard and inspired by AgentGRAI-web's `.claude/` architecture.

The integration creates:
- **`.afk/`** project directory (skills, plugins, settings) -- the agent's brain for this project
- **`.mcp.json`** MCP server declarations -- external tools the agent can discover and compose
- **`servers/`** directory -- TypeScript MCP server wrappers around project-specific operations
- **SSE streaming endpoint** -- real-time agent output via `query()` async generator
- **Batch endpoint** -- simple request/response via `queryText()`
- **Chat UI component** -- floating panel wired to the stream endpoint
- **Project-aware `buildQueryOptions()`** -- loads AFK.md, .mcp.json, plugins, and sets cwd

**Architecture:** The Next.js app is a server-component application as usual. The agent-afk SDK is wired as the orchestration runtime through API routes. The agent gets the full tool surface: MCP tools from `.mcp.json`, skills from `.afk/skills/`, plugins from `.afk/plugins/`, custom in-process tools via `tool()`, and all built-in agent-afk tools (bash, file I/O, grep, glob, web scrape). The app's `AFK.md` is the system prompt.

**Key advantage over Claude Agent SDK:** agent-afk's API is significantly simpler. `queryText(prompt, opts)` is a single async call. No `settingSources`, no `permissionMode`, no `TERM=dumb` ceremony. And it supports MCP servers, custom tools, plugins, and skills natively.

## When to Use This Skill

Use when the user requests:
- "Add agent-afk to this Next.js project"
- "Make this app agent-native"
- "Set up the agent runtime for this project"
- "Add AI agent capabilities with MCP tools"
- "Integrate agent-afk SDK with Next.js"
- "Add a chat interface powered by agent-afk"

**Prerequisites:**
- Existing Next.js 14+ project with App Router (src/app or app directory)
- Node.js 20+ installed
- pnpm installed (or npm/yarn)
- ANTHROPIC_API_KEY available

## Workflow

Follow these phases in order.

### Phase 1: Validate Project

Verify the current directory is a valid Next.js project.

```bash
node ~/.afk/skills/nextjs-afk-sdk/scripts/validate-project.js
```

If validation fails, inform the user and ask whether to fix issues or create a new project first.

Note the app directory location (src/app vs app) for subsequent phases.

### Phase 2: Install Dependencies

```bash
pnpm add agent-afk @modelcontextprotocol/sdk
pnpm add -D zod tsx
```

Or if pnpm is unavailable: `npm install agent-afk @modelcontextprotocol/sdk && npm install -D zod tsx`

- `agent-afk` -- the agent runtime SDK
- `@modelcontextprotocol/sdk` -- for writing TypeScript MCP servers
- `zod` -- schema validation for custom tools and MCP tool parameters
- `tsx` -- runs TypeScript MCP servers directly (no compile step needed)

Verify installation: check package.json includes `"agent-afk"` in dependencies.

### Phase 3: Create .afk/ Project Structure

Create the agent-native project scaffolding:

```
.afk/
  skills/          <- project-local skill definitions
  plugins/         <- symlinks to user-global plugins (or project-local plugins)
  plans/           <- agent plans directory
```

```bash
mkdir -p .afk/skills .afk/plugins .afk/plans
```

### Phase 4: Create MCP Server Infrastructure

Create `servers/` directory and `.mcp.json` at project root.

**servers/** contains TypeScript MCP server files. Each server exposes domain functions as MCP tools the agent can discover and call.

1. **`.mcp.json`** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/.mcp.json`
   - Declares MCP servers as stdio processes run via `npx tsx`
   - Format mirrors Claude Desktop's mcpServers schema
   - Env var interpolation via `${VAR_NAME}` syntax

2. **`servers/example-server.ts`** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/servers/example-server.ts`
   - Shows the pattern for wrapping operations as MCP tools using `@modelcontextprotocol/sdk`
   - Includes commented-out examples for: database queries, external APIs, CLI wrappers

**IMPORTANT:** After copying the example, the agent should ask the user what project-specific operations to expose as MCP tools, then create the actual server files. Common patterns:
- Database query tools (wrap an ORM, Prisma client, or raw SQL)
- External API tools (wrap fetch calls to third-party services)
- CLI wrapper tools (wrap existing scripts or commands via `execSync`)
- Data processing tools (transform, aggregate, analyze project data)

Each MCP server is a standalone TypeScript file that:
1. Creates an `McpServer` instance with a name and version
2. Registers tools with `server.tool(name, description, schema, handler)`
3. Connects via `StdioServerTransport` (agent-afk spawns it as a subprocess)

### Phase 5: Create Library Infrastructure

Create `src/lib/` (or `lib/` if app dir is at root) and copy utility files:

1. **src/lib/agentConfig.ts** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/lib/agentConfig.ts`
   - Exports: `validateEnvironment()`, `buildQueryOptions()`, `buildSkillPrompt()`
   - Loads AFK.md (user-global + project-local) as systemPrompt
   - Loads .mcp.json MCP server declarations
   - Discovers plugins from .afk/plugins/ (project-local + user-global)
   - Sets cwd to project root for bash/file tool anchoring
   - Validates and clamps model, maxTurns, maxBudgetUsd

2. **src/lib/logger.ts** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/lib/logger.ts`
   - Exports: `logInfo()`, `logError()`, `logWarn()`, `logDebug()`, `createSessionLogger()`

### Phase 6: Create API Routes

Create API routes for agent invocation:

1. **src/app/api/agent/route.ts** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/api/agent/route.ts`
   - POST endpoint for batch agent invocation
   - Accepts: `{ prompt, skillName?, model?, maxTurns?, maxBudgetUsd?, allowedTools? }`
   - Returns: `{ success, answer?, error? }`
   - Auth via `x-api-key` header with timing-safe comparison against AGENT_API_SECRET
   - Concurrency cap (default 3)
   - **CRITICAL:** `export const runtime = 'nodejs'` -- NOT 'edge'

2. **src/app/api/agent/stream/route.ts** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/api/agent/stream/route.ts`
   - POST endpoint for SSE streaming
   - Uses `query()` async generator inside `ReadableStream.start()`
   - Returns `text/event-stream` with `X-Accel-Buffering: no`
   - Same auth, validation, and concurrency as batch route

3. **src/app/api/health/route.ts** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/api/health/route.ts`
   - GET endpoint for health checking
   - Validates API key, agent-afk importable, MCP config present, .afk/ directory exists

Adjust paths if app directory is at root (app/) instead of src/app/.

### Phase 7: Create Chat UI Component

Copy the chat panel component:

1. **src/components/chat/chat-panel.tsx** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/components/chat/chat-panel.tsx`
   - Floating chat panel toggled by a button in the corner
   - Connects to `/api/agent/stream` SSE endpoint
   - Displays streaming messages and tool-call indicators

2. Add the chat component to the root layout:
   ```tsx
   import { ChatPanel } from '@/components/chat/chat-panel';
   // ... in the body, before closing </body>:
   <ChatPanel />
   ```

### Phase 8: Configure Next.js

Update `next.config.ts` to add `output: 'standalone'` (required for Docker deployment).

If no next.config.ts exists, copy from `~/.afk/skills/nextjs-afk-sdk/assets/next.config.ts`.

### Phase 9: Create Deployment Config

Copy deployment files:

1. **Dockerfile** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/Dockerfile`
   - Multi-stage build (deps -> build -> production)
   - Node.js only (TypeScript MCP servers, no Python needed)
   - Copies `.afk/`, `servers/`, `.mcp.json`, and `AFK.md` into production image

2. **railway.json** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/railway.json`

3. **.env.example** -- Copy from `~/.afk/skills/nextjs-afk-sdk/assets/.env.example`

### Phase 10: Enhance AFK.md

Update or create `AFK.md` at project root to serve as the agent's system prompt. Include:

- Project identity and purpose
- Available MCP tools and what they return
- Available skills and when to use them
- Read-only vs. write conventions
- Domain-specific rules and terminology

### Phase 11: Update .gitignore

Ensure `.gitignore` includes:
```
.env.local
.env*.local
# Plugin symlinks are per-machine (point to ~/.afk/plugins/)
# Uncomment if using symlinks:
# .afk/plugins/
```

### Phase 12: Configure Environment

Create `.env.local` from `.env.example` and prompt the user to add their keys:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
AGENT_API_SECRET=your-shared-secret-here
```

### Phase 13: Test Locally

1. Start dev server: `pnpm dev`
2. Test health: `curl http://localhost:3000/api/health`
3. Test batch agent:
   ```bash
   curl -X POST http://localhost:3000/api/agent \
     -H "Content-Type: application/json" \
     -H "x-api-key: your-shared-secret-here" \
     -d '{"prompt": "What tools do you have available?"}'
   ```
4. Test SSE stream:
   ```bash
   curl -N -X POST http://localhost:3000/api/agent/stream \
     -H "Content-Type: application/json" \
     -H "x-api-key: your-shared-secret-here" \
     -d '{"prompt": "Hello, what can you do?"}'
   ```

If health returns "unhealthy", check env vars in .env.local and restart the dev server.

### Phase 14: Create Project-Specific Skills

After the base integration is working, help the user create project-specific skills in `.afk/skills/`:

Each skill gets a directory with a `SKILL.md`:
```yaml
---
name: my-skill
description: "What this skill does"
---
# My Skill
## Instructions for the agent...
```

### Phase 15: Deployment Guidance

Provide deployment instructions:

1. `git add . && git commit -m "feat: agent-native integration with MCP servers and streaming" && git push`
2. Create Railway project from GitHub repo (or any Docker-capable host)
3. Set ANTHROPIC_API_KEY and AGENT_API_SECRET in the deployment platform's env vars
4. Platform auto-detects Dockerfile and deploys
5. Verify: `curl https://your-app.example.com/api/health`

**Vercel is NOT compatible** -- agent-afk requires Node.js runtime + subprocess spawning for MCP servers.

## Variations

### Structured Output

For typed, validated responses using Zod:

```typescript
import { queryStructured } from 'agent-afk';
import { z } from 'zod';

const AnalysisSchema = z.object({
  summary: z.string(),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
});

export async function POST(request: NextRequest) {
  const { text } = await request.json();
  const result = await queryStructured(
    `Analyze this text: ${text}`,
    AnalysisSchema,
    { model: 'sonnet' }
  );
  return NextResponse.json({ success: true, analysis: result });
}
```

### Custom In-Process Tools

Register tools that run inside the API route process (no MCP server needed):

```typescript
import { queryText, tool } from 'agent-afk';
import { z } from 'zod';

const dbQueryTool = tool(
  'query_database',
  'Run a read-only SQL query against the app database',
  z.object({ sql: z.string(), params: z.array(z.string()).optional() }),
  async ({ sql, params }) => {
    const result = await db.query(sql, params);
    return JSON.stringify(result.rows);
  },
);

export async function POST(request: NextRequest) {
  const { prompt } = await request.json();
  const answer = await queryText(prompt, {
    ...buildQueryOptions(),
    customTools: [dbQueryTool],
  });
  return NextResponse.json({ success: true, answer });
}
```

Use custom `tool()` for in-process operations (database queries, cache reads, computations). Use MCP servers for domain-specific CLIs, external APIs, or operations that benefit from their own process.

### Python MCP Servers

If you need to wrap existing Python CLIs or scripts, use the Python MCP SDK instead:

```python
from mcp.server import MCPServer
import subprocess

mcp = MCPServer("my-tool")

@mcp.tool()
def run_analysis(query: str) -> str:
    """Run the analysis CLI tool."""
    result = subprocess.run(["python3", "scripts/analyze.py", query],
                          capture_output=True, text=True)
    return result.stdout or result.stderr

if __name__ == "__main__":
    mcp.run()  # stdio transport
```

Declare in `.mcp.json` as `"command": "python3", "args": ["servers/my-tool-server.py"]` and add `python3` + `pip install mcp` to the Dockerfile.

## Technical Notes

**How this maps to AgentGRAI-web's .claude/:**

| AgentGRAI (.claude/) | This integration (.afk/) | How loaded |
|---|---|---|
| .claude/CLAUDE.md | AFK.md | Read and passed as `systemPrompt` |
| .claude/settings.json | .afk/settings.json | Via `cwd` discovery |
| .claude/skills/ | .afk/skills/ | Via `plugins` config |
| .claude/rules/ | Sections in AFK.md | AFK.md serves the same role |
| servers/ (MCP wrappers) | servers/ (MCP servers) | Declared in .mcp.json |

**Why query() doesn't auto-discover project config:**
The CLI/REPL auto-loads AFK.md, .mcp.json, plugins, and skills based on the working directory. The SDK's `query()`/`queryText()` does not -- everything must be passed explicitly through `QueryOptions`. The `buildQueryOptions()` function in `agentConfig.ts` bridges this gap by loading all project config and passing it through.

**Models:**
- `sonnet` -- Recommended (balanced speed/capability)
- `haiku` -- Faster, lower cost
- `opus` -- Most capable, higher cost

**Security:**
- Never commit .env.local or API keys
- AGENT_API_SECRET gates all agent endpoints (timing-safe comparison)
- Rate-limit /api/agent before production (agent calls are expensive)
- API routes are server-side only -- keys never reach the client
- MCP servers run as subprocesses -- isolate from untrusted input

**Performance:**
- First request may be slow (cold start + MCP server spawn)
- `maxBudgetUsd` caps spend per request (default $2.00)
- Concurrency cap prevents resource exhaustion (default 3)
- Use haiku for simple tasks, sonnet for complex ones
- MCP servers stay alive for the session duration (no per-call spawn overhead)
