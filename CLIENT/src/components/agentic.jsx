import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

// Shared UI for the two chat modes: the offline/agentic toggle and the
// agent's live tool-step chips.

const MODE_KEY = 'doritos-chat-mode';

// Chat mode persisted in localStorage so it carries across the dashboard
// composer and the in-chat composer.
export function useChatMode() {
  const [mode, setModeState] = useState(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'agentic' ? 'agentic' : 'offline';
    } catch {
      return 'offline';
    }
  });
  const setMode = (next) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // localStorage unavailable — keep the in-memory value
    }
  };
  return [mode, setMode];
}

export function ModeToggle({ mode, setMode, disabled }) {
  return (
    <div className="dispatch-mode" role="group" aria-label="Chat mode">
      <button
        type="button"
        disabled={disabled}
        className={`dispatch-mode__opt${mode === 'offline' ? ' is-active' : ''}`}
        onClick={() => setMode('offline')}
        title="Offline — local model, retrieve then answer"
      >
        Offline
      </button>
      <button
        type="button"
        disabled={disabled}
        className={`dispatch-mode__opt${mode === 'agentic' ? ' is-active' : ''}`}
        onClick={() => setMode('agentic')}
        title="Agentic — the model decides when to search your documents"
      >
        Agentic
      </button>
    </div>
  );
}

// Fold a streamed `step` event into the steps array.
export function applyStepEvent(steps, step) {
  if (step.phase === 'start') {
    return [...steps, { tool: step.tool, query: step.query, done: false }];
  }
  const next = [...steps];
  for (let i = next.length - 1; i >= 0; i--) {
    if (!next[i].done && next[i].tool === step.tool) {
      next[i] = { ...next[i], done: true };
      break;
    }
  }
  return next;
}

function stepLabel(step) {
  if (step.tool === 'search_documents') {
    const q = step.query ? ` “${step.query}”` : '';
    return step.done ? `Searched documents${q}` : `Searching documents${q}…`;
  }
  return step.done ? `${step.tool} — done` : `Running ${step.tool}…`;
}

export function AgentSteps({ steps }) {
  if (!steps?.length) return null;
  return (
    <div className="dispatch-steps">
      {steps.map((step, i) => (
        <div key={i} className={`dispatch-step${step.done ? ' is-done' : ''}`}>
          {step.done ? (
            <Check className="dispatch-step__icon" aria-hidden />
          ) : (
            <Loader2
              className="dispatch-step__icon dispatch-step__icon--spin"
              aria-hidden
            />
          )}
          <span>{stepLabel(step)}</span>
        </div>
      ))}
    </div>
  );
}
