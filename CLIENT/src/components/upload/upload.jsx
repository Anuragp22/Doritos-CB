import { useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Camera, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from '@/components/ui/dialog';

const Upload = ({ setImg }) => {
  const fileInputRef = useRef(null);
  const webcamRef = useRef(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const sendFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    setIsLoading(true);
    setImg((prev) => ({ ...prev, isLoading: true }));

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Upload failed');
      }
      const data = await response.json();
      setImg((prev) => ({
        ...prev,
        isLoading: false,
        dbData: { filePath: data.fileUrl },
      }));
    } catch (err) {
      toast.error(err.message);
      setImg((prev) => ({ ...prev, isLoading: false, error: err.message }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = (event) => {
    const file = event.target.files[0];
    if (file) sendFile(file);
  };

  const handleCapture = async () => {
    if (!webcamRef.current) return;
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;
    const blob = await fetch(imageSrc).then((res) => res.blob());
    const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
    setShowWebcam(false);
    sendFile(file);
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        className="hidden"
        onChange={handleUpload}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="rounded-full"
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        title="Attach an image"
      >
        <Paperclip className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="rounded-full"
        onClick={() => setShowWebcam(true)}
        disabled={isLoading}
        title="Capture from webcam"
      >
        <Camera className="size-4" />
      </Button>

      <Dialog open={showWebcam} onOpenChange={setShowWebcam}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Capture image</DialogTitle>
            <DialogDescription>
              Position yourself, then capture and attach to your prompt.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-lg border">
            <Webcam
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={{ facingMode: 'user' }}
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowWebcam(false)}
            >
              <X className="size-4" /> Cancel
            </Button>
            <Button type="button" onClick={handleCapture}>
              <Camera className="size-4" /> Capture
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Upload;
