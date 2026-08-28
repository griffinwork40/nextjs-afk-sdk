/**
 * agent-afk SDK configuration builder.
 *
 * Builds fully project-aware QueryOptions that wire:
 *   - AFK.md as system prompt overlay (user-global + project-local)
 *   - .mcp.json MCP server declarations
 *   - .afk/plugins/ (project-local + user-global)
 *   - Budget, model, and timeout controls
 *
 * query() does NOT auto-discover project config (that's CLI/REPL only).
 * Everything must be passed explicitly through QueryOptions.
 */
import type { QueryOptions } from 'agent-afk';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Project root -- all relative paths resolve from here. */
export const PROJECT_ROOT = resolve(__dirname, '../..');

/** Default model for API route invocations. */
export const DEFAULT_MODEL = 'sonnet';

/** Default max budget per request (USD). */
export const DEFAULT_MAX_BUDGET_USD = 2.0;

/** Default max turns per request. */
export const DEFAULT_MAX_TURNS = 50;

/** Allowlist of valid model identifiers. */
export const ALLOWED_MODELS = ['sonnet', 'haiku', 'opus'] as const;

// ---------------------------------------------------------------------------
// Project config loaders
// ---------------------------------------------------------------------------

/**
 * Load AFK.md from both user-global and project-local tiers.
 * User tier loads first (lower priority); project tier appended last (wins).
 */
function loadAfkMd(): string | undefined {
  const parts: string[] = [];
  const userMd = join(homedir(), '.afk', 'AFK.md');
  const projectMd = join(PROJECT_ROOT, 'AFK.md');

  if (existsSync(userMd)) parts.push(readFileSync(userMd, 'utf-8').trim());
  if (existsSync(projectMd)) parts.push(readFileSync(projectMd, 'utf-8').trim());

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/**
 * Load MCP server declarations from .mcp.json at project root.
 * Returns the mcpServers record or undefined if no file exists.
 */
function loadMcpServers(): Record<string, unknown> | undefined {
  const p = join(PROJECT_ROOT, '.mcp.json');
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    return raw.mcpServers ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Discover plugins from project-local and user-global .afk/plugins/ dirs.
 * Project-local takes precedence (checked first, deduped by name).
 */
function discoverPlugins(): Array<{ type: 'local'; path: string }> {
  const dirs = [
    join(PROJECT_ROOT, '.afk', 'plugins'), // project-local
    join(homedir(), '.afk', 'plugins'), // user-global
  ];
  const seen = new Set<string>();
  const plugins: Array<{ type: 'local'; path: string }> = [];

  for (const base of dirs) {
    try {
      for (const d of readdirSync(base, { withFileTypes: true })) {
        if (d.name.startsWith('.') || d.name === 'cache') continue;
        const fullPath = join(base, d.name);
        if (!seen.has(d.name)) {
          seen.add(d.name);
          plugins.push({ type: 'local', path: fullPath });
        }
      }
    } catch {
      // Directory doesn't exist -- skip
    }
  }

  return plugins;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate that the required environment variables are set. */
export function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!process.env.ANTHROPIC_API_KEY) {
    errors.push('ANTHROPIC_API_KEY is not set');
  }

  if (!process.env.AGENT_API_SECRET) {
    errors.push('AGENT_API_SECRET is not set');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build fully project-aware QueryOptions.
 *
 * Loads AFK.md, .mcp.json, plugins, and applies budget/model controls.
 * This is the single entry point for all agent invocations.
 */
export function buildQueryOptions(opts?: {
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
}): QueryOptions {
  // Validate model against allowlist
  const rawModel = opts?.model;
  const model =
    rawModel && (ALLOWED_MODELS as readonly string[]).includes(rawModel)
      ? rawModel
      : DEFAULT_MODEL;

  // Clamp maxTurns to [1, 100]
  const rawMaxTurns = opts?.maxTurns;
  const maxTurns =
    typeof rawMaxTurns === 'number'
      ? Math.min(Math.max(rawMaxTurns, 1), 100)
      : DEFAULT_MAX_TURNS;

  // Clamp maxBudgetUsd to [0.01, 10.00]
  const rawBudget = opts?.maxBudgetUsd;
  const maxBudgetUsd =
    typeof rawBudget === 'number'
      ? Math.min(Math.max(rawBudget, 0.01), 10.0)
      : DEFAULT_MAX_BUDGET_USD;

  const options: QueryOptions = {
    // -- Model & limits
    model,
    maxBudgetUsd,
    maxTurns,
    timeoutMs: 295_000,

    // -- Project root: drives bash cwd, file tool roots, .afk/ discovery
    cwd: PROJECT_ROOT,

    // -- System prompt: AFK.md content (user-global + project-local)
    systemPrompt: loadAfkMd(),

    // -- MCP servers from .mcp.json
    mcpServers: loadMcpServers() as QueryOptions['mcpServers'],

    // -- Plugins: project-local + user-global ~/.afk/plugins/
    plugins: discoverPlugins(),

    // -- Surface marker for hook routing
    surface: 'web',
  };

  // Tool allowlist (if specified by caller)
  if (
    Array.isArray(opts?.allowedTools) &&
    opts.allowedTools.every((t) => typeof t === 'string')
  ) {
    options.tools = { allowedTools: opts.allowedTools };
  }

  return options;
}

/**
 * Build a prompt that invokes a named skill.
 * agent-afk's skill router recognizes natural-language directives
 * and slash-command patterns.
 */
export function buildSkillPrompt(
  skillName: string,
  userPrompt: string,
): string {
  return `Use the ${skillName} skill to: ${userPrompt}`;
}
