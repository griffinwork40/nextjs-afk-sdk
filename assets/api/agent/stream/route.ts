/**
 * POST /api/agent/stream -- SSE streaming agent endpoint.
 *
 * Accepts: { prompt, skillName?, model?, maxTurns?, maxBudgetUsd? }
 * Returns: text/event-stream with agent output events.
 *
 * Uses agent-afk's query() async generator inside ReadableStream.start()
 * so the Response is returned immediately (no buffering the full response).
 */
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { query } from 'agent-afk';
import {
  validateEnvironment,
  buildQueryOptions,
  buildSkillPrompt,
} from '@/lib/agentConfig';
import { logInfo, logError } from '@/lib/logger';

// Must be nodejs runtime for agent-afk + MCP subprocess spawning
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Concurrency guard
const MAX_CONCURRENT = 3;
let activeCalls = 0;

export async function POST(request: NextRequest) {
  // Reject at concurrency cap
  if (activeCalls >= MAX_CONCURRENT) {
    return new Response(
      JSON.stringify({ error: 'Too many concurrent requests' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validate environment
  const env = validateEnvironment();
  if (!env.valid) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Authenticate via shared-secret header
  const providedKey = request.headers.get('x-api-key') ?? '';
  const expectedKey = process.env.AGENT_API_SECRET!;
  if (
    providedKey.length !== expectedKey.length ||
    !timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey))
  ) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse request
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { prompt, skillName, model, maxTurns, maxBudgetUsd, allowedTools } =
    body as {
      prompt?: string;
      skillName?: string;
      model?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
      allowedTools?: string[];
    };

  if (!prompt || typeof prompt !== 'string') {
    return new Response(
      JSON.stringify({ error: 'prompt is required and must be a string' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (prompt.length > 100_000) {
    return new Response(
      JSON.stringify({ error: 'prompt exceeds 100KB limit' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validate skillName
  if (skillName !== undefined) {
    if (
      typeof skillName !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(skillName)
    ) {
      return new Response(
        JSON.stringify({ error: 'skillName contains invalid characters' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  const reqId = crypto.randomUUID().slice(0, 8);
  logInfo('agent-stream', `Request ${reqId}`, {
    skillName,
    model,
    promptLength: prompt.length,
  });

  // Build prompt and options
  const finalPrompt = skillName
    ? buildSkillPrompt(skillName, prompt)
    : prompt;
  const options = buildQueryOptions({
    model,
    maxTurns,
    maxBudgetUsd,
    allowedTools,
  });

  const encoder = new TextEncoder();

  // Increment BEFORE constructing the ReadableStream so the concurrency guard
  // is accurate even if the Response is returned before start() fires.
  activeCalls++;

  // Return Response immediately; stream events inside ReadableStream.start()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = query(finalPrompt, options);

        for await (const event of generator) {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        logInfo('agent-stream', `Request ${reqId} complete`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logError('agent-stream', `Request ${reqId} failed`, {
          error: message,
        });
        // Mirror the batch route's NODE_ENV check — never expose raw error
        // messages to clients in production.
        const clientMessage =
          process.env.NODE_ENV === 'production' ? 'Internal server error' : message;
        const errorData = JSON.stringify({ type: 'error', error: clientMessage });
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
      } finally {
        activeCalls--;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
