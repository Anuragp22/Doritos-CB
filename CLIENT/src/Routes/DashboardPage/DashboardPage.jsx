import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Code2, Image as ImageIcon, MessageSquare, Square } from 'lucide-react';
import { readSSEStream } from '@/lib/stream';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import { useChatMode, ModeToggle, AgentSteps, applyStepEvent } from '@/components/agentic';
import '@/Routes/ChatPage/chatPage.css';

const API = import.meta.env.VITE_API_URL;

const SUGGESTIONS = [
  { icon: MessageSquare, label: 'Start a conversation' },
  { icon: ImageIcon, label: 'Analyze an image' },
  { icon: Code2, label: 'Help with my code' },
];

const DashboardPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [submittedText, setSubmittedText] = useState('');
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [streamingSources, setStreamingSources] = useState(null);
  const [error, setError] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [steps, setSteps] = useState([]);
  const [mode, setMode] = useChatMode();

  const controllerRef = useRef(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;

    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    setSubmittedText(text);
    setStreamingAnswer('');
    setStreamingSources(null);
    setError('');
    setSteps([]);
    setIsStreaming(true);

    let chatId = null;
    try {
      const res = await fetch(`${API}/api/chats`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode }),
        signal: controllerRef.current.signal,
      });

      await readSSEStream(res, (event) => {
        if (event.chatId) chatId = event.chatId;
        else if (event.text) setStreamingAnswer((prev) => prev + event.text);
        else if (event.sources) setStreamingSources(event.sources);
        else if (event.step) setSteps((prev) => applyStepEvent(prev, event.step));
        else if (event.error) setError(event.error);
      });

      queryClient.invalidateQueries({ queryKey: ['userChats'] });
      if (chatId) navigate(`/dashboard/chats/${chatId}`);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setIsStreaming(false);
    }
  };

  const cancel = () => controllerRef.current?.abort();

  const isThread = isStreaming || streamingAnswer || submittedText;

  return (
    <div className="dispatch-shell flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="dispatch-page">
          {isThread ? (
            <>
              <div className="dispatch-turn--user">
                <div className="dispatch-query">{submittedText}</div>
              </div>
              <div className="dispatch-turn--assistant">
                <AgentSteps steps={steps} />
                {streamingAnswer ? (
                  <>
                    <MarkdownMessage className="dispatch-body">{streamingAnswer}</MarkdownMessage>
                    <Citations sources={streamingSources} variant="footnote" />
                  </>
                ) : (
                  <div className="dispatch-thinking">Thinking</div>
                )}
              </div>
              {error && <div className="dispatch-error">{error}</div>}
            </>
          ) : (
            <div className="dispatch-landing-hero">
              <h1 className="dispatch-landing-hero__title">What can I help with?</h1>
              <ul className="dispatch-fields__list">
                {SUGGESTIONS.map(({ icon: Icon, label }) => (
                  <li key={label} className="dispatch-field">
                    <Icon className="dispatch-field__icon" aria-hidden />
                    <span className="dispatch-field__label">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="dispatch-composer-bar">
        <form onSubmit={handleSubmit} className="dispatch-composer">
          <input
            type="text"
            name="text"
            placeholder="Ask anything…"
            disabled={isStreaming}
            autoComplete="off"
          />
          <div className="dispatch-composer__actions">
            <ModeToggle mode={mode} setMode={setMode} disabled={isStreaming} />
            {isStreaming ? (
              <button
                type="button"
                onClick={cancel}
                aria-label="Stop"
                className="dispatch-composer__btn dispatch-composer__btn--cancel"
              >
                <Square className="size-3.5" fill="currentColor" />
              </button>
            ) : (
              <button type="submit" aria-label="Send" className="dispatch-composer__btn">
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default DashboardPage;
