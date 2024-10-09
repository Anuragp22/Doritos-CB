import Upload from '../upload/upload';
import './newPrompt.css';
import { useState, useEffect, useRef } from 'react';
import { IKImage } from 'imagekitio-react';
import model from '../../lib/gemini';
import Markdown from 'react-markdown';
const NewPrompt = () => {
  const endRef = useRef(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [img, setImg] = useState({
    isLoading: false,
    error: '',
    dbData: {},
    aiData: {},
  });

  useEffect(() => {
    endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [question, answer, img.dbData]);

  const add = async (text) => {
    try {
      setQuestion(text);
      setAnswer(''); // Clear previous answer
      setImg({ ...img, isLoading: true }); // Set loading state

      // Start generating content stream
      const result = await model.generateContentStream(text);

      // Stream each chunk of the response
      for await (const chunk of result.stream) {
        const chunkText = await chunk.text(); // Get the chunk text
        setAnswer((prevAnswer) => prevAnswer + chunkText); // Append chunk to the answer
      }

      setImg({
        isLoading: false,
        error: '',
        dbData: {},
        aiData: {},
      });
    } catch (error) {
      console.error('Error generating content:', error);
      setImg({
        isLoading: false,
        error: 'Failed to generate content',
        dbData: {},
        aiData: {},
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = e.target.text.value;
    if (!text) return;
    add(text);
  };

  return (
    <>
      {img.isLoading && <div className=''>Loading...</div>}
      {img.dbData?.filePath && (
        <IKImage
          urlEndpoint={import.meta.env.VITE_IMAGE_KIT_ENDPOINT}
          path={img.dbData?.filePath}
          width='380'
          transformation={[{ width: 380 }]}
        />
      )}
      {question && <div className='message user'>{question}</div>}
      {answer && (
        <div className='message'>
          <Markdown>{answer}</Markdown>
        </div>
      )}
      <div className='endChat' ref={endRef}></div>
      <form className='newForm' onSubmit={handleSubmit}>
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
