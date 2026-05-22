import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Code2, Image as ImageIcon, Loader2, MessageSquare, X } from 'lucide-react';
import Upload from '@/components/upload/upload';
import { useChatMode, ModeToggle } from '@/components/agentic';
import '@/Routes/ChatPage/chatPage.css';

const API = import.meta.env.VITE_API_URL;

const EMPTY_IMG = { isLoading: false, error: '', dbData: {}, aiData: {} };

const SUGGESTIONS = [
  { icon: MessageSquare, label: 'Start a conversation' },
  { icon: ImageIcon, label: 'Analyze an image' },
  { icon: Code2, label: 'Help with my code' },
];

const DashboardPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useChatMode();
  const [img, setImg] = useState(EMPTY_IMG);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const attachUrl = img.dbData?.filePath;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text && !attachUrl) return;

    setCreating(true);
    setError('');
    try {
      // Create the chat row, then drop into it — the first turn is sent (and
      // its answer streamed) on the chat page, not here.
      const res = await fetch(`${API}/api/chats`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('Could not create chat');
      const { chatId } = await res.json();
      queryClient.invalidateQueries({ queryKey: ['userChats'] });
      navigate(`/dashboard/chats/${chatId}`, {
        state: { pending: { text, img: attachUrl || null } },
      });
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  };

  return (
    <div className="dispatch-shell flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="dispatch-page">
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
            {error && <div className="dispatch-error">{error}</div>}
          </div>
        </div>
      </div>

      <div className="dispatch-composer-bar">
        <form onSubmit={handleSubmit} className="dispatch-composer">
          {(img.isLoading || attachUrl) && (
            <div className="dispatch-attach">
              {img.isLoading ? (
                <div className="dispatch-attach__thumb dispatch-attach__thumb--loading">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              ) : (
                <div className="dispatch-attach__thumb">
                  <img src={attachUrl} alt="Attachment" />
                  <button
                    type="button"
                    className="dispatch-attach__remove"
                    onClick={() => setImg(EMPTY_IMG)}
                    aria-label="Remove image"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="dispatch-composer__row">
            <input
              type="text"
              name="text"
              placeholder="Ask anything…"
              disabled={creating}
              autoComplete="off"
            />
            <div className="dispatch-composer__actions">
              <ModeToggle mode={mode} setMode={setMode} disabled={creating} />
              <span className="dispatch-composer__upload">
                <Upload setImg={setImg} />
              </span>
              <button
                type="submit"
                aria-label="Send"
                className="dispatch-composer__btn"
                disabled={creating}
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DashboardPage;
