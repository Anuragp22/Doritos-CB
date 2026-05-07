import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import Upload from '@/components/upload/upload';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import { readSSEStream } from '@/lib/stream';

const API = import.meta.env.VITE_API_URL;

const stamp = () => {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${day}.${months[d.getMonth()]}.${String(d.getFullYear()).slice(2)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const pad = (n) => String(n).padStart(3, '0');

export function useNewPrompt({ data, dispatchOffset = 0, queryOffset = 0 }) {
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

  const ts = stamp();
  const liveQueryNum = queryOffset + 1;
  const liveDispatchNum = dispatchOffset + 1;

  const streamingTurn = (
    <>
      {img.isLoading && <div className="dispatch-thinking">Receiving image…</div>}
      {img.dbData?.filePath && (
        <img
          src={img.dbData.filePath}
          alt="Uploaded preview"
          className="dispatch-pending-image"
        />
      )}
      {question && (
        <article className="dispatch-entry">
          <div className="dispatch-entry__rule">
            <span className="marker">Query № {pad(liveQueryNum)}</span>
            <span className="line" />
            <span className="stamp">{ts}</span>
          </div>
          <div className="dispatch-query">{question}</div>
        </article>
      )}
      {(answer || isStreaming) && (
        <article className="dispatch-entry">
          <div className="dispatch-entry__rule">
            <span className="marker">Dispatch № {pad(liveDispatchNum)}</span>
            <span className="line" />
            <span className="stamp">{ts}</span>
          </div>
          {answer ? (
            <>
              <MarkdownMessage className="dispatch-body">{answer}</MarkdownMessage>
              <Citations sources={sources} variant="footnote" />
            </>
          ) : (
            <div className="dispatch-thinking">Awaiting transmission</div>
          )}
        </article>
      )}
      {error && <div className="dispatch-error">{error}</div>}
    </>
  );

  const composer = (
    <form ref={formRef} onSubmit={handleSubmit} className="dispatch-composer">
      <span className="dispatch-composer__prompt" aria-hidden>{'>>'}</span>
      <input
        type="text"
        name="text"
        placeholder="Ask anything…"
        disabled={isStreaming}
        autoComplete="off"
        spellCheck="false"
      />
      <div className="flex items-center gap-2">
        <span className="dispatch-composer__upload">
          <Upload setImg={setImg} />
        </span>
        {isStreaming ? (
          <button
            type="button"
            onClick={cancel}
            className="dispatch-composer__btn dispatch-composer__btn--cancel"
          >
            <X className="size-3.5" />
            Stop
          </button>
        ) : (
          <button type="submit" className="dispatch-composer__btn">
            Send
            <span aria-hidden>&rarr;</span>
          </button>
        )}
      </div>
    </form>
  );

  return { streamingTurn, composer, isStreaming };
}
