import React, { useState } from 'react';
import { 
  CornerUpLeft, 
  ThumbsUp, 
  ThumbsDown, 
  Copy, 
  Check, 
  MoreHorizontal 
} from 'lucide-react';

export function MessageActions({
  messageContent,
  onReply,
  onFeedback,
}) {
  const [copied, setCopied] = useState(false);
  const [voted, setVoted] = useState(null);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(messageContent || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-1 mt-2 text-zinc-500">
      <button 
        onClick={onReply}
        title="Responder / Bifurcar" 
        className="p-1.5 rounded-lg hover:text-zinc-300 hover:bg-white/5 transition-colors"
      >
        <CornerUpLeft className="w-3.5 h-3.5" />
      </button>

      <button 
        onClick={() => { setVoted('up'); onFeedback?.('up'); }}
        title="Buena respuesta" 
        className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors ${voted === 'up' ? 'text-emerald-400' : 'hover:text-zinc-300'}`}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>

      <button 
        onClick={() => { setVoted('down'); onFeedback?.('down'); }}
        title="Mala respuesta" 
        className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors ${voted === 'down' ? 'text-red-400' : 'hover:text-zinc-300'}`}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>

      <button 
        onClick={handleCopy}
        title="Copiar texto" 
        className="p-1.5 rounded-lg hover:text-zinc-300 hover:bg-white/5 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      <button 
        title="Más opciones" 
        className="p-1.5 rounded-lg hover:text-zinc-300 hover:bg-white/5 transition-colors"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
