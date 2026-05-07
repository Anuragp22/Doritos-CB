/**
 * Read an SSE response body and dispatch each parsed event to the callback.
 * Returns when the stream ends. Throws on non-OK responses or transport errors.
 */
export async function readSSEStream(response, onEvent) {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `Request failed: ${response.status}`);
  }
  if (!response.body) throw new Error('Response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        if (!event.startsWith('data:')) continue;
        const payload = event.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload));
        } catch {
          // skip malformed event
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
