import React, { useState } from 'react';
import { 
  MoreHorizontal, 
  Copy, 
  Check, 
  RotateCw, 
  ThumbsUp, 
  ThumbsDown,
  CornerUpLeft,
  CornerDownLeft
} from 'lucide-react';

export const MessageToolbar = ({ onRetry, textToCopy }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-4 mt-3 text-zinc-500">
      <button className="hover:text-zinc-300 transition-colors" title="Responder">
        <CornerDownLeft className="w-4 h-4" />
      </button>
      <button className="hover:text-zinc-300 transition-colors" title="Me gusta">
        <ThumbsUp className="w-4 h-4" />
      </button>
      <button className="hover:text-zinc-300 transition-colors" title="No me gusta">
        <ThumbsDown className="w-4 h-4" />
      </button>
      <button onClick={handleCopy} className="hover:text-zinc-300 transition-colors" title="Copiar">
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      </button>
      {onRetry ? (
        <button onClick={onRetry} className="hover:text-zinc-300 transition-colors" title="Reintentar">
          <RotateCw className="w-4 h-4" />
        </button>
      ) : (
        <button className="hover:text-zinc-300 transition-colors" title="Más opciones">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
