import { ChatGroq } from '@langchain/groq';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { hybridRetrieve } from './rag.js';

// LangGraph ReAct agent for the "agentic" chat mode. The model (Groq — a fast
// cloud reasoning model; a 2B model on CPU is too slow for a multi-pass
// tool-calling loop) decides when to call `search_documents`, which runs the
// existing hybrid retrieval. The loop is streamed so the backend can surface
// reasoning, tool steps, and the answer separately.

const AGENT_MODEL = process.env.AGENT_MODEL || 'qwen/qwen3-32b';
const RECURSION_LIMIT = 8;

const SYSTEM_PROMPT = `You are the assistant for the Doritos AI document workspace.

When a question could be answered from the user's uploaded documents, ALWAYS call the search_documents tool first, then ground your answer in the retrieved passages and cite them inline as [1], [2], etc. If the passages do not contain the answer, say so plainly.

For general questions clearly unrelated to the user's documents, answer directly without searching.`;

// Convert the backend's internal message format
//   { role, content: [{ type:'text', text }, { type:'image', image }] }
// into LangChain message objects.
function toLangChainMessages(messages) {
  return messages.map((m) => {
    const parts = Array.isArray(m.content)
      ? m.content
      : [{ type: 'text', text: String(m.content ?? '') }];
    // The agent model is text-only. Drop image blocks from history — Groq
    // rejects non-text content for this model, and image turns are handled by
    // the offline vision path, not the agent.
    const content = parts
      .filter((p) => p.type !== 'image')
      .map((p) => ({ type: 'text', text: p.text || '' }));
    const role = m.role === 'model' ? 'assistant' : m.role;
    return role === 'assistant'
      ? new AIMessage({ content })
      : new HumanMessage({ content });
  });
}

function buildAgent({ userId, onSources }) {
  const searchDocuments = tool(
    async ({ query }) => {
      const chunks = await hybridRetrieve(query, userId);
      onSources?.(chunks);
      if (!chunks.length) {
        return "No relevant passages were found in the user's documents.";
      }
      return chunks
        .map((c, i) => `[${i + 1}] (${c.filename}) ${c.text}`)
        .join('\n\n');
    },
    {
      name: 'search_documents',
      description:
        "Search the user's uploaded documents for passages relevant to a query. Call this for any question that might be answered by the user's files.",
      schema: z.object({
        query: z.string().describe('What to look for in the documents.'),
      }),
    }
  );

  const llm = new ChatGroq({
    model: AGENT_MODEL,
    apiKey: process.env.GROQ_API_KEY,
    temperature: 0.3,
    reasoningFormat: 'parsed',
  });

  return createReactAgent({ llm, tools: [searchDocuments], prompt: SYSTEM_PROMPT });
}

// Pull reasoning + answer text out of a streamed message chunk. LangChain v1
// normalizes content into typed blocks on `contentBlocks`; fall back to a raw
// content array, a string, or reasoning carried in additional_kwargs.
function extractParts(message) {
  const out = [];
  const push = (b) => {
    if (b?.type === 'reasoning' && b.reasoning) {
      out.push({ kind: 'thinking', text: b.reasoning });
    } else if (b?.type === 'thinking' && b.thinking) {
      out.push({ kind: 'thinking', text: b.thinking });
    } else if (b?.type === 'text' && b.text) {
      out.push({ kind: 'text', text: b.text });
    }
  };
  const blocks = message?.contentBlocks;
  if (Array.isArray(blocks) && blocks.length) {
    blocks.forEach(push);
  } else if (Array.isArray(message?.content)) {
    message.content.forEach(push);
  } else if (typeof message?.content === 'string' && message.content) {
    out.push({ kind: 'text', text: message.content });
  }
  const rc =
    message?.additional_kwargs?.reasoning_content ??
    message?.additional_kwargs?.reasoning;
  if (typeof rc === 'string' && rc) out.push({ kind: 'thinking', text: rc });
  return out;
}

// Run the agent and yield normalized events:
//   { kind: 'thinking', text }            reasoning deltas
//   { kind: 'step', tool, phase, query? } tool lifecycle
//   { kind: 'sources', chunks }           raw retrieved chunks
//   { kind: 'text', text }                final-answer deltas
export async function* streamAgent(messages, { userId, signal } = {}) {
  let pendingSources = null;
  const agent = buildAgent({
    userId,
    onSources: (chunks) => {
      pendingSources = chunks;
    },
  });

  const stream = await agent.stream(
    { messages: toLangChainMessages(messages) },
    { streamMode: ['messages', 'tools'], recursionLimit: RECURSION_LIMIT, signal }
  );

  // Each chunk is a 2-tuple: [mode, payload].
  for await (const chunk of stream) {
    const [mode, payload] = chunk;
    if (mode === 'messages') {
      // payload is [message, metadata]; skip the tool-result echo.
      const [message, metadata] = payload;
      if (metadata?.langgraph_node && metadata.langgraph_node !== 'agent') continue;
      for (const part of extractParts(message)) yield part;
    } else if (mode === 'tools') {
      const ev = payload?.event;
      if (ev === 'on_tool_start') {
        let query;
        try {
          query =
            typeof payload.input === 'string'
              ? JSON.parse(payload.input).query
              : payload.input?.query;
        } catch {
          query = undefined;
        }
        yield { kind: 'step', tool: payload.name, phase: 'start', query };
      } else if (ev === 'on_tool_end') {
        if (pendingSources) {
          yield { kind: 'sources', chunks: pendingSources };
          pendingSources = null;
        }
        yield { kind: 'step', tool: payload.name, phase: 'end' };
      }
    }
  }
}
