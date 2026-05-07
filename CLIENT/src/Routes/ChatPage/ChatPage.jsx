import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useNewPrompt } from '@/components/newPrompt/NewPrompt';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import './chatPage.css';

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

  const { streamingTurn, composer, isStreaming } = useNewPrompt({
    data: data ?? null,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [data, isStreaming]);

  return (
    <div className="dispatch-shell flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="dispatch-page">
          {isPending ? (
            <div>
              <div className="dispatch-skel" style={{ width: '60%' }} />
              <div className="dispatch-skel" style={{ width: '95%' }} />
              <div className="dispatch-skel" style={{ width: '88%' }} />
            </div>
          ) : error ? (
            <div className="dispatch-error">Unable to load chat.</div>
          ) : (
            <>
              {data?.messages?.map((message) => {
                if (message.role === 'user') {
                  return (
                    <div key={message.id} className="dispatch-turn--user">
                      <div className="dispatch-query">
                        {message.imageUrl && (
                          <img
                            src={message.imageUrl}
                            alt="Attachment"
                            className="dispatch-query__image"
                            loading="lazy"
                          />
                        )}
                        {message.text}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={message.id} className="dispatch-turn--assistant">
                    <MarkdownMessage className="dispatch-body">{message.text}</MarkdownMessage>
                    <Citations sources={message.sources} variant="footnote" />
                  </div>
                );
              })}
              {streamingTurn}
            </>
          )}
        </div>
      </div>

      {data && <div className="dispatch-composer-bar">{composer}</div>}
    </div>
  );
};

export default ChatPage;
