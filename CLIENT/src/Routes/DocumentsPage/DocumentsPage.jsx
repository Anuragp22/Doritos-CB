import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import './DocumentsPage.css';

const API = import.meta.env.VITE_API_URL;

const DocumentsPage = () => {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () =>
      fetch(`${API}/api/documents`, { credentials: 'include' }).then((r) => r.json()),
  });

  const upload = useMutation({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}/api/documents`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Upload failed');
      return body;
    },
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`${API}/api/documents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Delete failed');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const file = e.target.file.files[0];
    if (!file) return;
    upload.mutate(file);
    e.target.reset();
  };

  return (
    <div className='documentsPage'>
      <h1>Documents</h1>
      <p className='hint'>
        Upload PDFs, Word documents, HTML, or any plain-text or code file.
        They get chunked, embedded, and used to ground future chat answers
        via hybrid retrieval (vector + full-text + reranker).
      </p>

      <form onSubmit={handleSubmit} className='uploadForm'>
        <input type='file' name='file' required />
        <button type='submit' disabled={upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {error && <div className='docError'>{error}</div>}

      {isLoading ? (
        <p>Loading…</p>
      ) : !data?.length ? (
        <p className='empty'>No documents yet.</p>
      ) : (
        <ul className='docList'>
          {data.map((doc) => (
            <li key={doc.id}>
              <div className='docInfo'>
                <strong>{doc.filename}</strong>
                <span className='meta'>
                  {doc.chunkCount} chunks · {new Date(doc.createdAt).toLocaleDateString()}
                </span>
              </div>
              <button
                type='button'
                onClick={() => remove.mutate(doc.id)}
                disabled={remove.isPending}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DocumentsPage;
