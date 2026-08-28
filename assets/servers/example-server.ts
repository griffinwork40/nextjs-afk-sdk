#!/usr/bin/env npx tsx
/**
 * Example MCP server for a Next.js agent-native project.
 *
 * This is a template -- replace the example tools with your project's
 * domain operations (database queries, API calls, CLI wrappers, etc.).
 *
 * Run standalone:   npx tsx servers/example-server.ts
 * Declared in:      .mcp.json (agent-afk spawns it via stdio)
 *
 * Install deps:     pnpm add @modelcontextprotocol/sdk zod
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'example',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// Example tools -- replace with your domain operations
// ---------------------------------------------------------------------------

server.tool(
  'hello',
  'Say hello to verify the MCP server is running',
  { name: z.string().describe('Name to greet') },
  async ({ name }) => ({
    content: [{ type: 'text', text: `Hello, ${name}! The MCP server is working.` }],
  }),
);

server.tool(
  'get_status',
  'Get the current application status and health metrics',
  {},
  async () => {
    // Replace with real status checks (database ping, cache hit rate, etc.)
    const status = {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      timestamp: new Date().toISOString(),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
    };
  },
);

// ---------------------------------------------------------------------------
// Patterns for common tool types (uncomment and adapt as needed)
// ---------------------------------------------------------------------------

// --- Database query tool ---
// server.tool(
//   'query_db',
//   'Run a read-only SQL query against the application database',
//   { sql: z.string().describe('SQL query (SELECT only)') },
//   async ({ sql }) => {
//     if (!sql.trim().toUpperCase().startsWith('SELECT')) {
//       return { content: [{ type: 'text', text: 'Error: only SELECT queries allowed' }] };
//     }
//     // const result = await db.query(sql);
//     // return { content: [{ type: 'text', text: JSON.stringify(result.rows) }] };
//   },
// );

// --- External API wrapper tool ---
// server.tool(
//   'fetch_weather',
//   'Get current weather for a location',
//   { city: z.string(), country: z.string().optional().default('US') },
//   async ({ city, country }) => {
//     const res = await fetch(`https://api.weather.example/${city}?country=${country}`);
//     const data = await res.json();
//     return { content: [{ type: 'text', text: JSON.stringify(data) }] };
//   },
// );

// --- CLI wrapper tool ---
// server.tool(
//   'run_lint',
//   'Run the project linter and return results',
//   {},
//   async () => {
//     // Use spawnSync with an argument array — never interpolate user input
//     // into a shell command string (shell injection risk).
//     const { spawnSync } = await import('child_process');
//     const result = spawnSync('npx', ['eslint', '.', '--format', 'json'], {
//       encoding: 'utf-8',
//       timeout: 30_000,
//     });
//     const output = result.stdout || result.stderr || 'No output';
//     return { content: [{ type: 'text', text: output }] };
//   },
// );

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
