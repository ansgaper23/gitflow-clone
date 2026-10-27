import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import CodeBlock from '../CodeBlock';

export const ResolutionSummary = ({ content }) => {
  if (!content) return null;
  let cleanContent = content
    .replace(/<suggestions>[\s\S]*?<\/suggestions>/gi, '')
    .replace(/<!--\s*suggestions[\s\S]*?-->/gi, '')
    .replace(/<!--\s*requires_approval[\s\S]*?-->/gi, '')
    .trim();
  if (!cleanContent) return null;

  // Normalizar viñetas con símbolo '•' pegadas o al inicio de líneas a listas Markdown reales '- '
  cleanContent = cleanContent
    .replace(/(^|\n)[ \t]*[•●][ \t]+/g, '$1- ')
    .replace(/([^\n])[ \t]+[•●][ \t]+/g, '$1\n\n- ');

  return (
    <div className="w-full text-sm text-zinc-200 leading-relaxed break-words whitespace-pre-wrap select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ node, ...props }) => (
            <p className="mb-2 leading-relaxed text-zinc-200 last:mb-0" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="my-2 pl-5 list-disc space-y-1.5 text-zinc-300" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-2 pl-5 list-decimal space-y-1.5 text-zinc-300" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="leading-relaxed mb-1.5 last:mb-0" {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-zinc-100" {...props} />
          ),
          h1: ({ node, ...props }) => (
            <h1 className="text-lg font-semibold text-zinc-100 mt-3 mb-1" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="text-base font-semibold text-zinc-100 mt-3 mb-1" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="text-sm font-semibold text-zinc-100 mt-3 mb-1" {...props} />
          ),
          pre: ({ children, ...props }) => (
            <pre className="my-2 rounded-md bg-zinc-900 border border-zinc-800 p-2 text-xs overflow-x-auto text-zinc-200" {...props}>
              {children}
            </pre>
          ),
          code: ({ node, inline, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : '';
            const codeString = String(children || '').replace(/\n$/, '');

            if (inline || (!match && !codeString.includes('\n'))) {
              return (
                <code className="px-1.5 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200 font-mono text-xs overflow-x-auto" {...props}>
                  {children}
                </code>
              );
            }

            return (
              <div className="my-2 rounded-md bg-zinc-900 border border-zinc-800 p-2 text-xs overflow-x-auto">
                <CodeBlock language={lang || 'text'} code={codeString} />
              </div>
            );
          },
          a: ({ node, href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 hover:text-violet-300 underline font-medium break-words"
              {...props}
            >
              {children}
            </a>
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400 italic" {...props} />
          ),
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
};

export default ResolutionSummary;
