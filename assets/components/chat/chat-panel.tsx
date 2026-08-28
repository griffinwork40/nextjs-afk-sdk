'use client';

/**
 * Floating chat panel for agent-afk interaction.
 *
 * Connects to /api/agent/stream SSE endpoint.
 * Drop into your root layout: <ChatPanel />
 *
 * The AGENT_API_SECRET is passed server-side via a proxy route or
 * server action. For development, the panel posts directly to the
 * stream endpoint with the key from a server-injected prop.
 */

import { useState, useRef, useEffect, FormEvent } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: string[];
}

interface ChatPanelProps {
  /**
   * Shared secret for the /api/agent/stream endpoint (x-api-key header).
   * Inject from a Server Component or environment variable — never hardcode
   * this value in client-side source. Example:
   *   <ChatPanel apiSecret={process.env.AGENT_API_SECRET} />
   */
  apiSecret?: string;
}

export function ChatPanel({ apiSecret }: ChatPanelProps = {}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    setLoading(true);

    let assistantContent = '';
    const toolCalls: string[] = [];

    try {
      const res = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiSecret ? { 'x-api-key': apiSecret } : {}),
        },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `Error: ${err.error || res.statusText}` },
        ]);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const event = JSON.parse(payload);

            // Handle different event types from agent-afk's query() generator
            if (event.type === 'text' || event.type === 'content_block_delta') {
              const text =
                event.content ?? event.delta?.text ?? event.text ?? '';
              assistantContent += text;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  // Spread into a new object — never mutate existing state references.
                  updated[updated.length - 1] = {
                    ...last,
                    content: assistantContent,
                    toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
                  };
                } else {
                  updated.push({
                    role: 'assistant',
                    content: assistantContent,
                    toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
                  });
                }
                return updated;
              });
            } else if (event.type === 'tool_use' || event.type === 'tool_call') {
              const name = event.name ?? event.tool ?? 'tool';
              toolCalls.push(name);
            } else if (event.type === 'error') {
              setMessages((prev) => [
                ...prev,
                { role: 'system', content: `Error: ${event.error}` },
              ]);
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      // Ensure final message is recorded
      if (assistantContent) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            // Spread into a new object — never mutate existing state references.
            updated[updated.length - 1] = { ...last, content: assistantContent };
          } else {
            updated.push({ role: 'assistant', content: assistantContent });
          }
          return updated;
        });
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Connection error: ${err instanceof Error ? err.message : 'unknown'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: '#0070f3',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          fontSize: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          zIndex: 9999,
        }}
        title="Open agent chat"
      >
        💬
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: 400,
        height: 500,
        border: '1px solid #333',
        borderRadius: 12,
        background: '#1a1a1a',
        color: '#e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9999,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#222',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>Agent Chat</span>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 18,
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: '#666', textAlign: 'center', marginTop: 40, fontSize: 13 }}>
            Ask the agent anything about this project.
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              background:
                msg.role === 'user'
                  ? '#0070f3'
                  : msg.role === 'system'
                    ? '#442222'
                    : '#2a2a2a',
              padding: '8px 12px',
              borderRadius: 8,
              maxWidth: '85%',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {msg.content}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: '#888',
                  fontStyle: 'italic',
                }}
              >
                Tools used: {msg.toolCalls.join(', ')}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ color: '#666', fontSize: 12, fontStyle: 'italic' }}>
            Agent is thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: 10,
          borderTop: '1px solid #333',
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #444',
            background: '#111',
            color: '#e0e0e0',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: 'none',
            background: loading || !input.trim() ? '#333' : '#0070f3',
            color: 'white',
            cursor: loading || !input.trim() ? 'default' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
