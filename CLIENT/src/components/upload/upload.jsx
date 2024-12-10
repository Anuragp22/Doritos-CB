// import { IKContext, IKImage, IKUpload } from 'imagekitio-react';
// import { useRef } from 'react';

// const publicKey = import.meta.env.VITE_IMAGE_KIT_PUBLIC_KEY;
// const urlEndpoint = import.meta.env.VITE_IMAGE_KIT_ENDPOINT;
// const authenticator = async () => {
//   try {
//     const response = await fetch('http://localhost:3000/api/upload');

//     if (!response.ok) {
//       const errorText = await response.text();
//       throw new Error(
//         `Request failed with status ${response.status}: ${errorText}`
//       );
//     }

//     const data = await response.json();
//     const { signature, expire, token } = data;
//     return { signature, expire, token };
//   } catch (error) {
//     throw new Error(`Authentication request failed: ${error.message}`);
//   }
// };

// const Upload = ({ setImg }) => {
//   const ikUploadRef = useRef(null);
//   const onError = (err) => {
//     console.log('Error', err);
//   };

//   const onSuccess = (res) => {
//     console.log('Success', res);
//     setImg((prev) => ({ ...prev, isLoading: false, dbData: res }));
//   };

//   const onUploadProgress = (progress) => {
//     console.log('Progress', progress);
//   };

//   const onUploadStart = (evt) => {
//     const file = evt.target.files[0];
//     const reader = new FileReader();
//     reader.onloadend = () => {
//       setImg((prev) => ({
//         ...prev,
//         isLoading: true,
//         aiData: {
//           inlineData: {
//             data: reader.result.split(',')[1],
//             mimeType: file.type,
//           },
//         },
//       }));
//     };
//     reader.readAsDataURL(file);
//   };
//   return (
//     <IKContext
//       publicKey={publicKey}
//       urlEndpoint={urlEndpoint}
//       authenticator={authenticator}
//     >
//       <IKUpload
//         fileName='test-upload.png'
//         onError={onError}
//         useUniqueFileName={true}
//         onSuccess={onSuccess}
//         onUploadProgress={onUploadProgress}
//         onUploadStart={onUploadStart}
//         style={{ display: 'none' }}
//         ref={ikUploadRef}
//       />
//       <label onClick={() => ikUploadRef.current.click()}>
//         <img src='/attachment.png' alt='' />
//       </label>
//     </IKContext>
//   );
// };

// export default Upload;
import React, { useRef } from 'react';

const Upload = ({ setImg }) => {
  const fileInputRef = useRef(null);

  const handleUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setImg((prev) => ({ ...prev, isLoading: true })); // Set loading state

      // Fetch the response from the server
      const response = await fetch(`${import.meta.env.VITE_API_URL}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${errorText}`);
      }

      const data = await response.json(); // Parse JSON after ensuring response is valid
      console.log('Upload Response Data:', data); // Debugging log

      if (data && data.fileUrl) {
        setImg((prev) => ({
          ...prev,
          isLoading: false,
          dbData: { filePath: data.fileUrl }, // Use fileUrl from the response
        }));
      } else {
        throw new Error('Invalid response format. No fileUrl found.');
      }
    } catch (err) {
      console.error('Upload Error:', err);
      setImg((prev) => ({ ...prev, isLoading: false, error: err.message }));
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  return (
    <>
      <input
        type='file'
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
      <button type='button' onClick={triggerFileInput}>
        <img src='/attachment.png' alt='Upload' style={{ cursor: 'pointer' }} />
      </button>
    </>
  );
};

export default Upload;
