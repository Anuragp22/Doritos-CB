import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import NewPrompt from '@/components/newPrompt/NewPrompt';
import MarkdownMessage from '@/components/markdownMessage';
import Citations from '@/components/citations';
import './chatPage.css';

const formatDateline = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months[d.getMonth()];
  const yr = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${yr} · ${hh}:${mm}`;
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data]);

  let dispatchCounter = 0;
  let queryCounter = 0;

  return (
    <div ref={scrollRef} className="dispatch-shell h-full overflow-y-auto">
      <header className="dispatch-mast">
        <h1 className="dispatch-mast__title">
          The Doritos <em>Dispatch</em>
        </h1>
      </header>

      <main className="dispatch-page">
        {isPending ? (
          <div>
            <div className="dispatch-skel" style={{ width: '60%' }} />
            <div className="dispatch-skel" style={{ width: '95%' }} />
            <div className="dispatch-skel" style={{ width: '88%' }} />
          </div>
        ) : error ? (
          <div className="dispatch-error">Unable to load chat.</div>
        ) : (
          data?.messages?.map((message) => {
            const isUser = message.role === 'user';
            const stamp = formatDateline(message.createdAt || data.createdAt || Date.now());

            if (isUser) {
              queryCounter += 1;
              return (
                <article key={message.id} className="dispatch-entry">
                  <div className="dispatch-entry__rule">
                    <span className="marker">Query № {String(queryCounter).padStart(3, '0')}</span>
                    <span className="line" />
                    <span className="stamp">{stamp}</span>
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

            dispatchCounter += 1;
            return (
              <article key={message.id} className="dispatch-entry">
                <div className="dispatch-entry__rule">
                  <span className="marker">Dispatch № {String(dispatchCounter).padStart(3, '0')}</span>
                  <span className="line" />
                  <span className="stamp">{stamp}</span>
                </div>
                <MarkdownMessage className="dispatch-body">{message.text}</MarkdownMessage>
                <Citations sources={message.sources} variant="footnote" />
              </article>
            );
          })
        )}

        {data && <NewPrompt data={data} dispatchOffset={dispatchCounter} queryOffset={queryCounter} />}
      </main>
    </div>
  );
};

export default ChatPage;
