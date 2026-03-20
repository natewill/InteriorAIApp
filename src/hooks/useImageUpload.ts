import { useCallback, useEffect, useState } from 'react';
import { validateImageFile } from '@/lib/imageValidation';

interface UseImageUploadProps {
  onImageChange: (image: string | null) => void;
}

export function useImageUpload({ onImageChange }: UseImageUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPasteTarget, setIsPasteTarget] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const validation = await validateImageFile(file);
      if (!validation.ok) {
        setError(validation.error ?? 'Invalid image file.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        setError(null);
        onImageChange(e.target?.result as string);
      };
      reader.onerror = () => {
        setError('Failed to read the image file.');
      };
      reader.readAsDataURL(file);
    },
    [onImageChange]
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (files.length > 1) {
        setError('Please upload only one image.');
        return;
      }
      void handleFile(files[0]);
    },
    [handleFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
    },
    [handleFiles]
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setError(null);
      onImageChange(null);
    },
    [onImageChange]
  );

  useEffect(() => {
    if (!isPasteTarget) return;

    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            void handleFile(file);
            event.preventDefault();
          }
          break;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handleFile, isPasteTarget]);

  return {
    isDragging,
    isPasteTarget,
    error,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleInputChange,
    handleRemove,
    setPasteTarget: setIsPasteTarget,
    setError,
  };
}
