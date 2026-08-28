/**
 * GET /api/health -- Health check for agent-native integration.
 *
 * Validates: API key configured, agent-afk importable, MCP config present,
 * .afk/ directory exists.
 *
 * Specific env-var names are only returned to authenticated callers
 * (x-api-key == AGENT_API_SECRET) to prevent information leakage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { validateEnvironment, PROJECT_ROOT } from '@/lib/agentConfig';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const checks: Record<string, boolean | string> = {};
  const errors: string[] = [];

  // Determine whether the caller is authenticated so we can decide how much
  // detail to surface in the errors[] array.
  const secret = process.env.AGENT_API_SECRET ?? '';
  const providedKey = request.headers.get('x-api-key') ?? '';
  const isAuthenticated =
    secret.length > 0 &&
    providedKey.length === secret.length &&
    timingSafeEqual(Buffer.from(providedKey), Buffer.from(secret));

  // Check API keys
  const env = validateEnvironment();
  checks.apiKey = env.valid;
  if (!env.valid) {
    // Only expose specific variable names to authenticated callers.
    if (isAuthenticated) {
      errors.push(...env.errors);
    } else {
      errors.push('Required environment variables are not configured');
    }
  }

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

  return NextResponse.json(
    {
      status,
      checks,
      ...(errors.length > 0 && { errors }),
      timestamp: new Date().toISOString(),
    },
    errors.length > 0 ? { status: 503 } : undefined,
  );
}
