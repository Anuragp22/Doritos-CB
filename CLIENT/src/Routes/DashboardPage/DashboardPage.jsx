import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import './DashboardPage.css';
import { readSSEStream } from '../../lib/stream';

const API = import.meta.env.VITE_API_URL;

const DashboardPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [submittedText, setSubmittedText] = useState('');
  const [streamingAnswer, setStreamingAnswer] = useState('');
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
      <div className='dashboardPage streaming'>
        <div className='streamPreview'>
          <div className='message user'>{submittedText}</div>
          {streamingAnswer && (
            <div className='message'>
              <Markdown>{streamingAnswer}</Markdown>
            </div>
          )}
          {error && <div className='streamError'>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className='dashboardPage'>
      <div className='texts'>
        <div className='logo'>
          <img src='/logo.png' alt='' />
          <h1>DORITOS AI</h1>
        </div>
        <div className='options'>
          <div className='option'>
            <img src='/chat.png' alt='' />
            <span>Create a New Chat</span>
          </div>
          <div className='option'>
            <img src='/image.png' alt='' />
            <span>Analyze Images</span>
          </div>
          <div className='option'>
            <img src='/code.png' alt='' />
            <span>Help me with my Code</span>
          </div>
        </div>
      </div>
      <div className='formContainer'>
        <form onSubmit={handleSubmit}>
          <input type='text' name='text' placeholder='Ask me anything...' />
          <button type='submit'>
            <img src='/arrow.png' alt='' />
          </button>
        </form>
      </div>
    </div>
  );
};

export default DashboardPage;
