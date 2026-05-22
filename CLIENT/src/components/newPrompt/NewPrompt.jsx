import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Square, Scissors, Undo2, X, Loader2 } from 'lucide-react';
import Upload from '@/components/upload/upload';
import SegmentDialog from '@/components/segment/SegmentDialog';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import { readSSEStream } from '@/lib/stream';
import { useChatMode, ModeToggle, AgentSteps, applyStepEvent } from '@/components/agentic';

const API = import.meta.env.VITE_API_URL;

const EMPTY_IMG = { isLoading: false, error: '', dbData: {}, aiData: {} };

export function useNewPrompt({ data }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState(null);
  const [error, setError] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [steps, setSteps] = useState([]);
  const [mode, setMode] = useChatMode();
  const [img, setImg] = useState(EMPTY_IMG);
  const [sentImage, setSentImage] = useState(null); // the in-flight turn's image
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [segmentEnabled, setSegmentEnabled] = useState(false);

  const controllerRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    fetch(`${API}/api/segment/status`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setSegmentEnabled(Boolean(d.enabled)))
      .catch(() => setSegmentEnabled(false));
  }, []);

  const sendTurn = async (text) => {
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    const imageUrl = img.dbData?.filePath || null;

    setQuestion(text);
    setSentImage(imageUrl);
    setAnswer('');
    setSources(null);
    setError('');
    setSteps([]);
    setIsStreaming(true);
    setImg(EMPTY_IMG); // the attachment has moved into the chat — clear the composer

    try {
      const res = await fetch(`${API}/api/chats/${data.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          img: imageUrl || undefined,
          mode,
        }),
        signal: controllerRef.current.signal,
      });

      await readSSEStream(res, (event) => {
        if (event.text) setAnswer((prev) => prev + event.text);
        else if (event.sources) setSources(event.sources);
        else if (event.step) setSteps((prev) => applyStepEvent(prev, event.step));
        else if (event.error) setError(event.error);
      });

      await queryClient.invalidateQueries({ queryKey: ['chat', data.id] });
      setQuestion('');
      setAnswer('');
      setSources(null);
      setSteps([]);
      setSentImage(null);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    // A turn needs text, an image, or both.
    if (!text && !img.dbData?.filePath) return;
    e.target.reset(); // clear the input now — don't let it linger while streaming
    sendTurn(text);
  };

  const cancel = () => controllerRef.current?.abort();

  const clearImage = () => setImg(EMPTY_IMG);
  const revertCutout = () =>
    setImg((prev) => ({
      ...prev,
      dbData: { ...prev.dbData, filePath: prev.dbData.originalPath },
    }));

  const attachUrl = img.dbData?.filePath;
  const isCutout =
    attachUrl && img.dbData?.originalPath && attachUrl !== img.dbData.originalPath;

  // The in-flight user turn — rendered the same way ChatPage renders a
  // persisted user message, so there is no visual jump after the refetch.
  const streamingTurn = (
    <>
      {(sentImage || question) && (
        <div className="dispatch-turn--user">
          <div className="dispatch-query">
            {sentImage && (
              <img
                src={sentImage}
                alt="Attachment"
                className="dispatch-query__image"
                loading="lazy"
              />
            )}
            {question}
          </div>
        </div>
      )}
      {(answer || isStreaming) && (
        <div className="dispatch-turn--assistant">
          <AgentSteps steps={steps} />
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
    <>
      <form onSubmit={handleSubmit} className="dispatch-composer">
        {(img.isLoading || attachUrl) && (
          <div className="dispatch-attach">
            {img.isLoading ? (
              <div className="dispatch-attach__thumb dispatch-attach__thumb--loading">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : (
              <>
                <div className="dispatch-attach__thumb">
                  <img src={attachUrl} alt="Attachment" />
                  <button
                    type="button"
                    className="dispatch-attach__remove"
                    onClick={clearImage}
                    aria-label="Remove image"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                {segmentEnabled && (
                  <div className="dispatch-attach__actions">
                    <button type="button" onClick={() => setSegmentOpen(true)}>
                      <Scissors className="size-3.5" /> Select object
                    </button>
                    {isCutout && (
                      <button type="button" onClick={revertCutout}>
                        <Undo2 className="size-3.5" /> Revert
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="dispatch-composer__row">
          <input
            type="text"
            name="text"
            placeholder="Reply to Doritos…"
            disabled={isStreaming}
            autoComplete="off"
          />
          <div className="dispatch-composer__actions">
            <ModeToggle mode={mode} setMode={setMode} disabled={isStreaming} />
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
        </div>
      </form>

      {img.dbData?.originalPath && (
        <SegmentDialog
          open={segmentOpen}
          onOpenChange={setSegmentOpen}
          imageUrl={img.dbData.originalPath}
          onApply={(cutoutUrl) =>
            setImg((prev) => ({
              ...prev,
              dbData: { ...prev.dbData, filePath: cutoutUrl },
            }))
          }
        />
      )}
    </>
  );

  return { streamingTurn, composer, isStreaming };
}
