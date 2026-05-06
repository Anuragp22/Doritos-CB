import React, { useRef, useState } from 'react';
import Webcam from 'react-webcam';
import './upload.css';
import { FaCamera, FaUpload, FaTimes } from 'react-icons/fa';

const Upload = ({ setImg }) => {
  const fileInputRef = useRef(null);
  const webcamRef = useRef(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    try {
      setIsLoading(true);
      setImg((prev) => ({ ...prev, isLoading: true }));

      const response = await fetch(`${import.meta.env.VITE_API_URL}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${errorText}`);
      }

      const data = await response.json();
      setImg((prev) => ({
        ...prev,
        isLoading: false,
        dbData: { filePath: data.fileUrl },
      }));
    } catch (err) {
      console.error(err);
      setError(err.message);
      setImg((prev) => ({ ...prev, isLoading: false, error: err.message }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCapture = async () => {
    if (!webcamRef.current) return;

    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    const blob = await fetch(imageSrc).then((res) => res.blob());
    const formData = new FormData();
    formData.append('file', blob, 'capture.jpg');

    try {
      setIsLoading(true);
      setImg((prev) => ({ ...prev, isLoading: true }));

      const response = await fetch(`${import.meta.env.VITE_API_URL}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${errorText}`);
      }

      const data = await response.json();
      setImg((prev) => ({
        ...prev,
        isLoading: false,
        dbData: { filePath: data.fileUrl },
      }));
    } catch (err) {
      console.error(err);
      setError(err.message);
      setImg((prev) => ({ ...prev, isLoading: false, error: err.message }));
    } finally {
      setIsLoading(false);
      setShowWebcam(false); // Close the webcam after capture
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  return (
    <div className='upload-container'>
      <input
        type='file'
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      <div className='button-group'>
        <button
          type='button'
          className='upload-button'
          onClick={triggerFileInput}
        >
          <FaUpload />
        </button>
        <button
          type='button'
          className='webcam-button'
          onClick={() => setShowWebcam(!showWebcam)}
        >
          {showWebcam ? <FaTimes /> : <FaCamera />}
        </button>
      </div>

      {showWebcam && (
        <div className='webcam-container'>
          <Webcam
            ref={webcamRef}
            screenshotFormat='image/jpeg'
            videoConstraints={{ facingMode: 'user' }}
            className='webcam-preview'
          />
          <button
            type='button'
            className='capture-button'
            onClick={handleCapture}
          >
            <FaCamera />
          </button>
        </div>
      )}

      {isLoading && <div className='loading-spinner'>Uploading...</div>}

      {error && <div className='error-message'>Error: {error}</div>}
    </div>
  );
};

export default Upload;
