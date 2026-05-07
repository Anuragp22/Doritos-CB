import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Loader2, AlertCircle, Bot, User as UserIcon } from 'lucide-react';
import NewPrompt from '@/components/newPrompt/NewPrompt';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const ChatPage = () => {
  const path = useLocation().pathname;
  const chatId = path.split('/').pop();
  const scrollRef = useRef(null);

  const { isPending, error, data } = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () =>
      fetch(`${import.meta.env.VITE_API_URL}/api/chats/${chatId}`, {
        credentials: 'include',
      }).then((res) => res.json()),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-12 w-2/3 self-end" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>Failed to load chat.</span>
            </div>
          ) : (
            data?.messages?.map((message) => {
              const isUser = message.role === 'user';
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-3',
                    isUser ? 'flex-row-reverse' : 'flex-row'
                  )}
                >
                  <Avatar
                    className={cn(
                      'size-8 shrink-0 border',
                      isUser ? 'bg-primary/10' : 'bg-accent'
                    )}
                  >
                    <AvatarFallback className="bg-transparent">
                      {isUser ? (
                        <UserIcon className="size-4" />
                      ) : (
                        <Bot className="size-4 text-primary" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={cn(
                      'flex flex-col gap-2',
                      isUser ? 'items-end' : 'items-start'
                    )}
                  >
                    {message.imageUrl && (
                      <img
                        src={message.imageUrl}
                        alt="Attachment"
                        className="max-h-72 max-w-md rounded-lg border object-cover"
                        loading="lazy"
                      />
                    )}
                    <div
                      className={cn(
                        'rounded-2xl px-4 py-3 text-sm',
                        isUser
                          ? 'max-w-[80%] bg-accent'
                          : 'max-w-full bg-card border'
                      )}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {message.text}
                        </p>
                      ) : (
                        <MarkdownMessage>{message.text}</MarkdownMessage>
                      )}
                    </div>
                    {!isUser && <Citations sources={message.sources} />}
                  </div>
                </div>
              );
            })
          )}
          {data && <NewPrompt data={data} />}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
