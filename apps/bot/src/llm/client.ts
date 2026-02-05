import { createAgent } from '@tansui/core';
import type { AgentEvent } from '@tansui/types';

import { getConfig } from '../config.js';

export type LlmClient = {
  generateReply: (input: string, sessionId?: string) => Promise<string>;
  streamReply: (input: string, sessionId?: string) => AsyncGenerator<string, void, void>;
};

const STREAM_CHUNK_SIZE = 120;

function extractResultText(events: AgentEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'result') {
      continue;
    }

    const data = event.data as { text?: unknown } | undefined;
    if (typeof data?.text === 'string' && data.text.length > 0) {
      return data.text;
    }
  }
  return undefined;
}

export function createLlmClient(): LlmClient {
  const config = getConfig();
  const agent = createAgent({
    llm: {
      apiKey: config.llmApiKey,
      model: config.llmModel,
      baseURL: config.llmBaseUrl,
      timeout: config.llmTimeoutMs
    }
  });

  const generateReply = async (input: string, sessionId?: string): Promise<string> => {
    const events = await agent.run(input, sessionId);
    const text = extractResultText(events);
    if (!text) {
      throw new Error('Agent response missing result text');
    }
    return text;
  };

  return {
    generateReply,
    async *streamReply(input: string, sessionId?: string): AsyncGenerator<string, void, void> {
      // Core agent returns a full response; we chunk it to simulate streaming updates.
      const text = await generateReply(input, sessionId);
      for (let index = 0; index < text.length; index += STREAM_CHUNK_SIZE) {
        yield text.slice(index, index + STREAM_CHUNK_SIZE);
      }
    }
  };
}
