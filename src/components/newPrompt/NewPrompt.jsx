import './newPrompt.css';
import { useEffect, useRef } from 'react';

const NewPrompt = () => {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <>
      <div className='endChat' ref={endRef}></div>
      <div className='newForm'>
        <form>
          <label htmlFor='file'>
            <img src='/attachment.png' alt='' />
          </label>
          <input id='file' type='file' multiple={false} hidden />
          <input type='text' placeholder='Ask any thing...' />
          <button>
            <img src='/arrow.png' alt='' />
          </button>
        </form>
      </div>
    </>
  );
};

export default NewPrompt;
