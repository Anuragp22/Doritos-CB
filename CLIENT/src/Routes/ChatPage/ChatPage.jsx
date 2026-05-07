import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useNewPrompt } from '@/components/newPrompt/NewPrompt';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import './chatPage.css';

const formatDateline = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${day}.${months[d.getMonth()]}.${String(d.getFullYear()).slice(2)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

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

  let dispatchCounter = 0;
  let queryCounter = 0;
  if (data?.messages) {
    for (const m of data.messages) {
      if (m.role === 'user') queryCounter += 1;
      else dispatchCounter += 1;
    }
  }

  const { streamingTurn, composer, isStreaming } = useNewPrompt({
    data: data ?? null,
    dispatchOffset: dispatchCounter,
    queryOffset: queryCounter,
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
                const isUser = message.role === 'user';
                const ts = formatDateline(message.createdAt || data.createdAt || Date.now());

                if (isUser) {
                  let n = 0;
                  for (const m of data.messages) {
                    if (m.role === 'user') {
                      n += 1;
                      if (m.id === message.id) break;
                    }
                  }
                  return (
                    <article key={message.id} className="dispatch-entry">
                      <div className="dispatch-entry__rule">
                        <span className="marker">Query № {String(n).padStart(3, '0')}</span>
                        <span className="line" />
                        <span className="stamp">{ts}</span>
                      </div>
                      {message.imageUrl && (
                        <img
                          src={message.imageUrl}
                          alt="Attachment"
                          className="dispatch-query__image"
                          loading="lazy"
                        />
                      )}
                      <div className="dispatch-query">{message.text}</div>
                    </article>
                  );
                }

                let n = 0;
                for (const m of data.messages) {
                  if (m.role !== 'user') {
                    n += 1;
                    if (m.id === message.id) break;
                  }
                }
                return (
                  <article key={message.id} className="dispatch-entry">
                    <div className="dispatch-entry__rule">
                      <span className="marker">Dispatch № {String(n).padStart(3, '0')}</span>
                      <span className="line" />
                      <span className="stamp">{ts}</span>
                    </div>
                    <MarkdownMessage className="dispatch-body">{message.text}</MarkdownMessage>
                    <Citations sources={message.sources} variant="footnote" />
                  </article>
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
