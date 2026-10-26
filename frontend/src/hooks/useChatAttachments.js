import { useState, useCallback, useEffect } from 'react';

export function useChatAttachments() {
  const [attachments, setAttachments] = useState([]);

  const addFiles = useCallback((files) => {
    const fileList = Array.from(files);
    
    const newAttachments = fileList.map(file => {
      const isImage = file.type.startsWith('image/');
      return {
        id: crypto.randomUUID(),
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        name: file.name,
        size: file.size,
        isImage,
        isZip: file.name.endsWith('.zip')
      };
    });

    setAttachments(prev => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = useCallback((id) => {
    setAttachments(prev => {
      const target = prev.find(a => a.id === id);
      if (target && target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    attachments.forEach(a => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
    setAttachments([]);
  }, [attachments]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToUpload = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) filesToUpload.push(file);
      }
    }

    if (filesToUpload.length > 0) {
      e.preventDefault(); 
      addFiles(filesToUpload);
    }
  }, [addFiles]);

  // Listen to global drop events
  useEffect(() => {
    const handleGlobalDrop = (e) => {
      if (e.detail && e.detail.files) {
        addFiles(e.detail.files);
      }
    };
    window.addEventListener('chat-staged-drop', handleGlobalDrop);
    return () => window.removeEventListener('chat-staged-drop', handleGlobalDrop);
  }, [addFiles]);

  return {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    handlePaste,
  };
}
