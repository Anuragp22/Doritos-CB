import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Bot, Loader2, User as UserIcon, X } from 'lucide-react';
import Upload from '@/components/upload/upload';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { readSSEStream } from '@/lib/stream';
import { cn } from '@/lib/utils';

const API = import.meta.env.VITE_API_URL;

const NewPrompt = ({ data }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState(null);
  const [error, setError] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [img, setImg] = useState({
    isLoading: false,
    error: '',
    dbData: {},
    aiData: {},
  });

  const endRef = useRef(null);
  const formRef = useRef(null);
  const controllerRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data, question, answer, img.dbData]);

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

  return (
    <>
      {img.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Uploading…
        </div>
      )}
      {img.dbData?.filePath && (
        <div className="self-end">
          <img
            src={img.dbData.filePath}
            alt="Uploaded preview"
            className="max-h-60 max-w-sm rounded-lg border object-cover"
          />
        </div>
      )}
      {question && (
        <div className="flex flex-row-reverse gap-3">
          <Avatar className="size-8 shrink-0 border bg-primary/10">
            <AvatarFallback className="bg-transparent">
              <UserIcon className="size-4" />
            </AvatarFallback>
          </Avatar>
          <div className="rounded-2xl bg-accent px-4 py-3 text-sm max-w-[80%]">
            <p className="whitespace-pre-wrap leading-relaxed">{question}</p>
          </div>
        </div>
      )}
      {(answer || isStreaming) && (
        <div className="flex gap-3">
          <Avatar className="size-8 shrink-0 border bg-accent">
            <AvatarFallback className="bg-transparent">
              <Bot className="size-4 text-primary" />
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col gap-1">
            <div className="rounded-2xl border bg-card px-4 py-3 text-sm">
              {answer ? (
                <MarkdownMessage>{answer}</MarkdownMessage>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Thinking…
                </div>
              )}
            </div>
            <Citations sources={sources} />
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div ref={endRef} />

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className={cn(
          'sticky bottom-4 mt-4 flex w-full items-center gap-2 rounded-2xl border bg-card/80 px-3 py-2 shadow-lg backdrop-blur'
        )}
      >
        <Upload setImg={setImg} />
        <input
          type="text"
          name="text"
          placeholder="Ask anything…"
          disabled={isStreaming}
          className="flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        {isStreaming ? (
          <Button
            type="button"
            onClick={cancel}
            size="icon"
            variant="destructive"
            className="rounded-full"
          >
            <X className="size-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" className="rounded-full">
            <ArrowUp className="size-4" />
          </Button>
        )}
      </form>
    </>
  );
};

export default NewPrompt;
