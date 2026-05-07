import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Trash2, Upload as UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const API = import.meta.env.VITE_API_URL;

const DocumentsPage = () => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

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
    onSuccess: (body) => {
      toast.success(`Indexed ${body.chunkCount ?? ''} chunks`.trim());
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => toast.error(err.message),
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
    onSuccess: () => {
      toast.success('Document removed');
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFiles = (files) => {
    if (!files?.length) return;
    upload.mutate(files[0]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Upload PDFs, Word documents, HTML, or any plain-text or code file.
            They get chunked, embedded, and used to ground future answers via
            hybrid retrieval (vector + full-text + reranker).
          </p>
        </div>

        <Card
          className="mb-6"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UploadIcon className="size-4" />
              Add to corpus
            </CardTitle>
            <CardDescription>
              Drop a file here, or click below to choose one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label
              htmlFor="doc-file"
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-sm transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted/40'
              }`}
            >
              {upload.isPending ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  Uploading & indexing…
                </>
              ) : (
                <>
                  <UploadIcon className="size-5" />
                  Click or drop a file
                </>
              )}
              <input
                id="doc-file"
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
                disabled={upload.isPending}
              />
            </label>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !data?.length ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            No documents yet. Upload one above to get started.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card/40 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {doc.filename}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {doc.chunkCount} chunks ·{' '}
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => remove.mutate(doc.id)}
                  disabled={remove.isPending}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default DocumentsPage;
