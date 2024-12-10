import { useEffect, useRef, useState } from 'react';
import './newPrompt.css';
import Upload from '../upload/upload';
import Markdown from 'react-markdown';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const NewPrompt = ({ data }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [img, setImg] = useState({
    isLoading: false,
    error: '',
    dbData: {},
    aiData: {},
  });

  // Check if data.history exists, and ensure it's properly formatted
  // const chatHistory = data?.history?.length
  //   ? data.history.map(({ role, parts }) => ({
  //       role,
  //       parts: [{ text: parts[0]?.text || '' }], // Handle potential undefined parts
  //     }))
  //   : []; // Default to an empty array if no history is present

  // const chat = model.startChat({
  //   history: chatHistory,
  //   generationConfig: {
  //     // maxOutputTokens: 100,
  //   },
  // });

  const endRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => {
    endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [data, question, answer, img.dbData]);

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      return fetch(`${import.meta.env.VITE_API_URL}/api/chats/${data._id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: question.length ? question : undefined,
          answer,
          img: img.dbData?.filePath || undefined,
        }),
      }).then((res) => res.json());
    },
    onSuccess: () => {
      queryClient
        .invalidateQueries({ queryKey: ['chat', data._id] })
        .then(() => {
          formRef.current.reset();
          setQuestion('');
          setAnswer('');
          setImg({
            isLoading: false,
            error: '',
            dbData: {},
            aiData: {},
          });
        });
    },
    onError: (err) => {
      console.log(err);
    },
  });

  const add = async (text, isInitial) => {
    if (!isInitial) setQuestion(text); // Set the user question

    try {
      console.log('Image URL:', img.dbData.filePath); // Check before forming payload

      const payload = {
        user_text: text || null,
        image_url: img.dbData?.filePath || null, // Ensure filePath is used
      };
      console.log('Payload:', payload);

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/generate`, // Use your backend URL
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Request failed with status ${response.status}: ${errorText}`
        );
      }

      const data = await response.json();
      const { description } = data; // Extract description or explanation

      setAnswer(description); // Update the answer in the UI

      // Update the conversation history in the database
      mutation.mutate();
    } catch (err) {
      console.error('Error in add function:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const text = e.target.text.value;
    if (!text) return;

    add(text, false);
  };

  // IN PRODUCTION WE DON'T NEED IT
  const hasRun = useRef(false);

  useEffect(() => {
    if (!hasRun.current) {
      if (data?.history?.length === 1) {
        add(data.history[0].parts[0]?.text || '', true); // Handle potential undefined parts
      }
    }
    hasRun.current = true;
  }, [data]);

  return (
    <>
      {/* ADD NEW CHAT */}
      {img.isLoading && <div>Loading...</div>}
      {img.dbData?.filePath && (
        <img
          src={img.dbData.filePath}
          alt='Uploaded Preview'
          style={{ width: '380px' }}
        />
      )}
      {question && <div className='message user'>{question}</div>}
      {answer && (
        <div className='message'>
          <Markdown>{answer}</Markdown>
        </div>
      )}

      <div className='endChat' ref={endRef}></div>
      <form className='newForm' onSubmit={handleSubmit} ref={formRef}>
        <Upload setImg={setImg} />
        <input id='file' type='file' multiple={false} hidden />
        <input type='text' name='text' placeholder='Ask anything...' />
        <button>
          <img src='/arrow.png' alt='' />
        </button>
      </form>
    </>
  );
};

export default NewPrompt;
