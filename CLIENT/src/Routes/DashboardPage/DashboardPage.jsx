import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Code2, Image as ImageIcon, MessageSquare, Loader2 } from 'lucide-react';
import { readSSEStream } from '@/lib/stream';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';

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
    setIsStreaming(true);

    let chatId = null;
    try {
      const res = await fetch(`${API}/api/chats`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controllerRef.current.signal,
      });

      await readSSEStream(res, (event) => {
        if (event.chatId) chatId = event.chatId;
        else if (event.text) setStreamingAnswer((prev) => prev + event.text);
        else if (event.sources) setStreamingSources(event.sources);
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

  if (isStreaming || streamingAnswer) {
    return (
      <div className="flex h-full flex-col items-center px-6 py-8">
        <div className="flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto">
          <div className="self-end max-w-[80%] rounded-2xl bg-accent px-4 py-3 text-sm">
            {submittedText}
          </div>
          {streamingAnswer ? (
            <div className="flex max-w-[90%] flex-col gap-1 self-start">
              <Card className="gap-0 px-5 py-4">
                <MarkdownMessage>{streamingAnswer}</MarkdownMessage>
              </Card>
              <Citations sources={streamingSources} />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Thinking…
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center px-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-10">
        <div className="flex items-center gap-4 opacity-90">
          <img src="/logo.png" alt="" className="size-14" />
          <h1 className="gradient-text text-5xl font-bold tracking-tight md:text-6xl">
            DORITOS AI
          </h1>
        </div>
        <div className="grid w-full max-w-3xl grid-cols-1 gap-3 md:grid-cols-3">
          {SUGGESTIONS.map(({ icon: Icon, label }) => (
            <Card
              key={label}
              className="cursor-pointer items-start gap-3 px-4 py-4 transition-colors hover:bg-accent/40"
            >
              <Icon className="size-7 text-muted-foreground" />
              <span className="text-sm">{label}</span>
            </Card>
          ))}
        </div>
      </div>
      <form
        onSubmit={handleSubmit}
        className="mb-6 flex w-full max-w-3xl items-center gap-2 rounded-2xl border bg-card/60 px-4 py-2"
      >
        <input
          type="text"
          name="text"
          placeholder="Ask anything…"
          className="flex-1 bg-transparent px-2 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="icon" className="rounded-full">
          <ArrowUp className="size-4" />
        </Button>
      </form>
    </div>
  );
};

export default DashboardPage;
