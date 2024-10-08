import Upload from '../upload/upload';
import './newPrompt.css';
import { useState, useEffect, useRef } from 'react';
import { IKImage } from 'imagekitio-react';
const NewPrompt = () => {
  const endRef = useRef(null);

  const [img, setImg] = useState({
    isLoading: false,
    error: '',
    dbData: {},
  });

  useEffect(() => {
    endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, []);

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
      <div className='endChat' ref={endRef}></div>
      <div className='newForm'>
        <form>
          <Upload setImg={setImg} />
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
