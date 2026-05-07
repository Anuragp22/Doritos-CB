// Rough char-to-token approximation: ~4 chars/token for English.
// Qwen2-VL-2B-Instruct has a 32K context window. We reserve ~2K for the
// response and ~2K for the augmented prompt overhead, leaving 28K tokens
// (~112K chars) for replayed history. Default budget below is conservative.
const DEFAULT_BUDGET = 96000;

// Vision encoder roughly emits 256-1024 tokens per image depending on
// resolution. We charge a flat 1024 tokens (~4096 chars) per image block.
const IMAGE_CHAR_EQUIVALENT = 4096;

function estimateMessageChars(message) {
  return message.content.reduce((sum, block) => {
    if (block.type === 'text') return sum + (block.text?.length || 0);
    if (block.type === 'image') return sum + IMAGE_CHAR_EQUIVALENT;
    return sum;
  }, 0);
}

/**
 * Drop oldest user/assistant pairs until the remaining messages fit under
 * `budget` (in approximate characters). The final message is always
 * preserved — that is the latest user turn we are about to send to the
 * model. If a user message was followed by an assistant message we drop
 * them together so the conversation stays well-formed.
 */
export function pruneHistory(messages, budget = DEFAULT_BUDGET) {
  if (messages.length <= 1) return messages;

  let total = messages.reduce((sum, m) => sum + estimateMessageChars(m), 0);
  if (total <= budget) return messages;

  const pruned = messages.slice();

  while (total > budget && pruned.length > 1) {
    const dropped = pruned.shift();
    total -= estimateMessageChars(dropped);

    if (
      dropped.role === 'user' &&
      pruned.length > 1 &&
      pruned[0].role === 'assistant'
    ) {
      const droppedAssistant = pruned.shift();
      total -= estimateMessageChars(droppedAssistant);
    }
  }

  return pruned;
}
