import React, { useState } from 'react';
import { Code2, WrapText, Copy, Check } from 'lucide-react';

const LANGUAGE_LABELS = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  sql: 'SQL',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Zsh',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  text: 'Text',
  txt: 'Text',
  markdown: 'Markdown',
  md: 'Markdown',
  python: 'Python',
  py: 'Python',
  yaml: 'YAML',
  yml: 'YAML'
};

export default function CodeBlock({ language = 'text', code = '' }) {
  const [copied, setCopied] = useState(false);
  const [isWrapped, setIsWrapped] = useState(false);

  const normalizedLang = (language || '').toLowerCase().trim();
  const displayLang = LANGUAGE_LABELS[normalizedLang] || (normalizedLang ? normalizedLang.charAt(0).toUpperCase() + normalizedLang.slice(1) : 'Text');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className="my-3.5 rounded-xl border border-zinc-800/80 bg-[#121215] overflow-hidden shadow-xl text-left">
      {/* Barra superior estilo Sublime / Lovable */}
      <div className="bg-[#18181b]/80 border-b border-zinc-800/60 px-4 py-2 flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <Code2 className="size-3.5 text-zinc-400" />
          <span className="text-xs font-medium text-zinc-300 font-mono tracking-wide">{displayLang}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsWrapped(!isWrapped)}
            title={isWrapped ? "Desactivar ajuste de línea" : "Ajustar líneas"}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
              isWrapped ? 'bg-zinc-700/60 text-blue-400' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <WrapText className="size-3.5" />
            <span className="hidden sm:inline text-[11px]">Wrap</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            title="Copiar código"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md transition-colors"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-400" />
                <span className="text-emerald-400 text-[11px] font-medium">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5 text-zinc-400" />
                <span className="text-[11px]">Copiar</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Cuerpo del código */}
      <div className="p-4 overflow-x-auto select-text">
        <pre className={`font-mono text-[13px] leading-relaxed text-zinc-200 m-0 ${isWrapped ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}>
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
