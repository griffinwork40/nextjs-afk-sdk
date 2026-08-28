# nextjs-afk-sdk

An [agent-afk](https://github.com/griffinwork40/agent-afk) skill that transforms Next.js projects into **agent-native** applications -- where agent-afk is the runtime that orchestrates operations through discoverable MCP tools, skills, and plugins.

## What It Does

Adds to any Next.js 14+ App Router project:

- **`.afk/`** project directory -- skills, plugins, plans (the agent's brain)
- **`.mcp.json`** + **`servers/`** -- TypeScript MCP servers the agent discovers and composes
- **`POST /api/agent`** -- Batch agent invocation with auth and concurrency control
- **`POST /api/agent/stream`** -- SSE streaming agent endpoint via `query()` generator
- **`GET /api/health`** -- Health check for SDK, MCP, and project config
- **Chat UI** -- Floating panel wired to the streaming endpoint
- **Project-aware config** -- `buildQueryOptions()` loads AFK.md, .mcp.json, plugins, sets cwd
- **Deployment config** -- Dockerfile + Railway setup, production-ready

Inspired by AgentGRAI-web's `.claude/` architecture, generalized for agent-afk's `.afk/` conventions.

## Quick Start

### Install as an AFK Skill

```bash
git clone https://github.com/griffinwork40/nextjs-afk-sdk.git ~/.afk/skills/nextjs-afk-sdk
```

The skill auto-loads in all future AFK sessions. Then in any session, tell the agent:

> "Make this Next.js project agent-native"

### What Gets Created

```
your-nextjs-project/
├── .afk/
│   ├── skills/                    # Project-local skill definitions
│   ├── plugins/                   # Symlinks to ~/.afk/plugins/
│   └── plans/                     # Agent plans directory
├── servers/
│   └── example-server.ts          # TypeScript MCP server template
├── src/
│   ├── app/api/
│   │   ├── agent/
│   │   │   ├── route.ts           # Batch agent endpoint
│   │   │   └── stream/route.ts    # SSE streaming endpoint
│   │   └── health/route.ts        # Health check
│   ├── components/chat/
│   │   └── chat-panel.tsx         # Floating chat UI
│   └── lib/
│       ├── agentConfig.ts         # Project-aware SDK config builder
│       └── logger.ts              # Structured logging
├── .mcp.json                      # MCP server declarations
├── AFK.md                         # Agent system prompt
├── Dockerfile                     # Production deployment
├── railway.json                   # Railway config
└── .env.example                   # Environment template
```

## API Usage

### Batch Query

```bash
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret" \
  -d '{"prompt": "What tools do you have available?"}'
```

### SSE Streaming

```bash
curl -N -X POST http://localhost:3000/api/agent/stream \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret" \
  -d '{"prompt": "Analyze the project structure"}'
```

### Request Options

```json
{
  "prompt": "Your prompt here",
  "skillName": "optional-skill-name",
  "model": "sonnet",
  "maxTurns": 50,
  "maxBudgetUsd": 2.00,
  "allowedTools": ["bash", "read_file"]
}
```

## SDK Features

### `queryText(prompt, opts)` -- Simple One-Shot

Returns a `Promise<string>`. Owns the full session lifecycle.

```typescript
import { queryText } from 'agent-afk';

const answer = await queryText('Explain quantum computing', {
  model: 'sonnet',
  maxBudgetUsd: 2.00,
});
```

### `query(prompt, opts)` -- Streaming

Returns an `AsyncGenerator<OutputEvent>` for real-time SSE streaming.

```typescript
import { query } from 'agent-afk';

for await (const event of query('Write a story', { model: 'sonnet' })) {
  // Stream events to client
}
```

### `queryStructured(prompt, schema, opts)` -- Typed Output

Returns a Zod-validated typed response with automatic retry on parse failure.

```typescript
import { queryStructured } from 'agent-afk';
import { z } from 'zod';

const result = await queryStructured(
  'Analyze this text',
  z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    confidence: z.number(),
  }),
  { model: 'sonnet' }
);
```

### `tool()` -- Custom In-Process Tools

Register tools the agent can invoke during execution:

```typescript
import { queryText, tool } from 'agent-afk';
import { z } from 'zod';

const dbTool = tool(
  'query_db',
  'Query the application database',
  z.object({ sql: z.string() }),
  async ({ sql }) => JSON.stringify(await db.query(sql)),
);

const answer = await queryText('How many users signed up today?', {
  ...buildQueryOptions(),
  customTools: [dbTool],
});
```

### MCP Servers -- External Tool Discovery

TypeScript MCP servers in `servers/` expose domain operations the agent discovers via `.mcp.json`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'my-app', version: '1.0.0' });

server.tool('get_metrics', 'Get app metrics', {}, async () => ({
  content: [{ type: 'text', text: JSON.stringify(await fetchMetrics()) }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Architecture Mapping

| AgentGRAI (.claude/) | This skill (.afk/) | How loaded |
|---|---|---|
| .claude/CLAUDE.md | AFK.md | Read as `systemPrompt` in QueryOptions |
| .claude/settings.json | .afk/settings.json | Via `cwd` discovery |
| .claude/skills/ | .afk/skills/ | Via `plugins` config |
| .claude/rules/ | Sections in AFK.md | AFK.md serves the same role |
| servers/ (MCP wrappers) | servers/ (MCP servers) | Declared in .mcp.json |

## Deployment

### Railway (Recommended)

1. Push to GitHub
2. Create Railway project from your repo
3. Set `ANTHROPIC_API_KEY` and `AGENT_API_SECRET` in Railway Variables
4. Railway auto-detects the Dockerfile and deploys
5. Verify: `curl https://your-app.railway.app/api/health`

### Other Platforms

Any Docker-capable platform works (Render, Fly.io, Google Cloud Run).

**Vercel is NOT compatible** -- agent-afk requires the Node.js runtime + subprocess spawning for MCP servers.

## Requirements

- Next.js 14+ with App Router
- Node.js 20+
- `ANTHROPIC_API_KEY` from [Anthropic Console](https://console.anthropic.com/)

## License

MIT
