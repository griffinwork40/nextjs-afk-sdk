/**
 * GET /api/health -- Health check for agent-native integration.
 *
 * Validates: API key configured, agent-afk importable, MCP config present,
 * .afk/ directory exists.
 */
import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { join } from 'path';
import { validateEnvironment, PROJECT_ROOT } from '@/lib/agentConfig';

export const runtime = 'nodejs';

export async function GET() {
  const checks: Record<string, boolean | string> = {};
  const errors: string[] = [];

  // Check API keys
  const env = validateEnvironment();
  checks.apiKey = env.valid;
  if (!env.valid) errors.push(...env.errors);

  // Check agent-afk is importable
  try {
    const afk = await import('agent-afk');
    checks.agentAfk = typeof afk.queryText === 'function';
  } catch {
    checks.agentAfk = false;
    errors.push('agent-afk package not importable');
  }

  // Check .mcp.json exists
  const mcpPath = join(PROJECT_ROOT, '.mcp.json');
  checks.mcpConfig = existsSync(mcpPath);
  if (!checks.mcpConfig) {
    checks.mcpConfigNote = 'No .mcp.json found -- MCP tools unavailable';
  }

  // Check .afk/ directory
  const afkDir = join(PROJECT_ROOT, '.afk');
  checks.afkDir = existsSync(afkDir);

  // Check AFK.md
  const afkMd = join(PROJECT_ROOT, 'AFK.md');
  checks.afkMd = existsSync(afkMd);

  const status = errors.length === 0 ? 'healthy' : 'unhealthy';

  return NextResponse.json({
    status,
    checks,
    ...(errors.length > 0 && { errors }),
    timestamp: new Date().toISOString(),
  });
}
