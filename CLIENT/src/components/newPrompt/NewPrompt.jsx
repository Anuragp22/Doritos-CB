import { useEffect, useRef, useState } from 'react';
import './newPrompt.css';
import Upload from '../upload/upload';
import Markdown from 'react-markdown';
import { useQueryClient } from '@tanstack/react-query';
import { readSSEStream } from '../../lib/stream';

const API = import.meta.env.VITE_API_URL;

const NewPrompt = ({ data }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
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
  const queryClient = useQueryClient();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data, question, answer, img.dbData]);

  const sendTurn = async (text) => {
    setQuestion(text);
    setAnswer('');
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
      });

      await readSSEStream(res, (event) => {
        if (event.text) setAnswer((prev) => prev + event.text);
        else if (event.error) setError(event.error);
      });

      await queryClient.invalidateQueries({ queryKey: ['chat', data.id] });
      formRef.current?.reset();
      setQuestion('');
      setAnswer('');
      setImg({ isLoading: false, error: '', dbData: {}, aiData: {} });
    } catch (err) {
      setError(err.message);
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

  return (
    <>
      {img.isLoading && <div>Loading…</div>}
      {img.dbData?.filePath && (
        <img src={img.dbData.filePath} alt='Uploaded preview' style={{ width: '380px' }} />
      )}
      {question && <div className='message user'>{question}</div>}
      {answer && (
        <div className='message'>
          <Markdown>{answer}</Markdown>
        </div>
      )}
      {error && <div className='message error'>{error}</div>}

      <div className='endChat' ref={endRef}></div>
      <form className='newForm' onSubmit={handleSubmit} ref={formRef}>
        <Upload setImg={setImg} />
        <input id='file' type='file' multiple={false} hidden />
        <input
          type='text'
          name='text'
          placeholder='Ask anything…'
          disabled={isStreaming}
        />
        <button type='submit' disabled={isStreaming}>
          <img src='/arrow.png' alt='' />
        </button>
      </form>
    </>
  );
};

export default NewPrompt;
