/**
 * POST /api/agent -- Invoke agent-afk programmatically (batch mode).
 *
 * Accepts: { prompt, skillName?, model?, maxTurns?, maxBudgetUsd?, allowedTools? }
 * Returns: { success, answer?, error? }
 *
 * For streaming, use /api/agent/stream instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { queryText } from 'agent-afk';
import {
  validateEnvironment,
  buildQueryOptions,
  buildSkillPrompt,
} from '@/lib/agentConfig';
import { logInfo, logError } from '@/lib/logger';

// CRITICAL: Must be 'nodejs' -- agent-afk requires Node.js runtime, not Edge
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

// Concurrency guard
const MAX_CONCURRENT = 3;
let activeCalls = 0;

export async function POST(request: NextRequest) {
  const reqId = crypto.randomUUID().slice(0, 8);

  // Reject at concurrency cap
  if (activeCalls >= MAX_CONCURRENT) {
    return NextResponse.json(
      { success: false, error: 'Too many concurrent requests' },
      { status: 429 },
    );
  }

  try {
    // Authenticate FIRST — never leak env details to unauthenticated callers.
    const providedKey = request.headers.get('x-api-key') ?? '';
    const expectedKey = process.env.AGENT_API_SECRET ?? '';
    if (
      !expectedKey ||
      providedKey.length !== expectedKey.length ||
      !timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey))
    ) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    // Validate environment (after auth — details are safe to return now)
    const env = validateEnvironment();
    if (!env.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
          details: env.errors,
        },
        { status: 500 },
      );
    }

    // Parse request
    const body = await request.json();
    const { prompt, skillName, model, maxTurns, maxBudgetUsd, allowedTools } =
      body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { success: false, error: 'prompt is required and must be a string' },
        { status: 400 },
      );
    }

    if (prompt.length > 100_000) {
      return NextResponse.json(
        { success: false, error: 'prompt exceeds 100KB limit' },
        { status: 400 },
      );
    }

    // Validate skillName
    if (skillName !== undefined) {
      if (
        typeof skillName !== 'string' ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(skillName)
      ) {
        return NextResponse.json(
          { success: false, error: 'skillName contains invalid characters' },
          { status: 400 },
        );
      }
    }

    logInfo('agent', `Request ${reqId}`, {
      skillName,
      model,
      promptLength: prompt.length,
    });

    // Build the final prompt (with optional skill invocation)
    const finalPrompt = skillName
      ? buildSkillPrompt(skillName, prompt)
      : prompt;

    // Build project-aware options (AFK.md, MCP servers, plugins, cwd)
    const options = buildQueryOptions({
      model,
      maxTurns,
      maxBudgetUsd,
      allowedTools,
    });

    // Execute -- queryText owns the full session lifecycle
    activeCalls++;
    try {
      const answer = await queryText(finalPrompt, options);
      logInfo('agent', `Request ${reqId} complete`, {
        answerLength: answer.length,
      });
      return NextResponse.json({ success: true, answer });
    } finally {
      activeCalls--;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logError('agent', `Request ${reqId} failed`, { error: message });

    return NextResponse.json(
      {
        success: false,
        error:
          process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : message,
      },
      { status: 500 },
    );
  }
}
