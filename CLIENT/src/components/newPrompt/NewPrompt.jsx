import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Square } from 'lucide-react';
import Upload from '@/components/upload/upload';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import { readSSEStream } from '@/lib/stream';

const API = import.meta.env.VITE_API_URL;

export function useNewPrompt({ data }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState(null);
  const [error, setError] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [img, setImg] = useState({ isLoading: false, error: '', dbData: {}, aiData: {} });

  const formRef = useRef(null);
  const controllerRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => () => controllerRef.current?.abort(), []);

  const sendTurn = async (text) => {
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    setQuestion(text);
    setAnswer('');
    setSources(null);
    setError('');
    setIsStreaming(true);

    try {
      const res = await fetch(`${API}/api/chats/${data.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          img: img.dbData?.filePath || undefined,
        }),
        signal: controllerRef.current.signal,
      });

      await readSSEStream(res, (event) => {
        if (event.text) setAnswer((prev) => prev + event.text);
        else if (event.sources) setSources(event.sources);
        else if (event.error) setError(event.error);
      });

      await queryClient.invalidateQueries({ queryKey: ['chat', data.id] });
      formRef.current?.reset();
      setQuestion('');
      setAnswer('');
      setSources(null);
      setImg({ isLoading: false, error: '', dbData: {}, aiData: {} });
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    sendTurn(text);
  };

  const cancel = () => controllerRef.current?.abort();

  const streamingTurn = (
    <>
      {img.isLoading && <div className="dispatch-thinking">Uploading image</div>}
      {img.dbData?.filePath && (
        <div className="dispatch-turn--user">
          <img
            src={img.dbData.filePath}
            alt="Uploaded preview"
            className="dispatch-pending-image"
          />
        </div>
      )}
      {question && (
        <div className="dispatch-turn--user">
          <div className="dispatch-query">{question}</div>
        </div>
      )}
      {(answer || isStreaming) && (
        <div className="dispatch-turn--assistant">
          {answer ? (
            <>
              <MarkdownMessage className="dispatch-body">{answer}</MarkdownMessage>
              <Citations sources={sources} variant="footnote" />
            </>
          ) : (
            <div className="dispatch-thinking">Thinking</div>
          )}
        </div>
      )}
      {error && <div className="dispatch-error">{error}</div>}
    </>
  );

  const composer = (
    <form ref={formRef} onSubmit={handleSubmit} className="dispatch-composer">
      <input
        type="text"
        name="text"
        placeholder="Reply to Doritos…"
        disabled={isStreaming}
        autoComplete="off"
      />
      <div className="dispatch-composer__actions">
        <span className="dispatch-composer__upload">
          <Upload setImg={setImg} />
        </span>
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
  );

  return { streamingTurn, composer, isStreaming };
}
