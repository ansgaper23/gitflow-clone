import React from 'react';
import ReactMarkdown from 'react-markdown';
import CodeBlock from '../CodeBlock';

export const ResolutionSummary = ({ content }) => {
  if (!content) return null;
  const cleanContent = content
    .replace(/<suggestions>[\s\S]*?<\/suggestions>/gi, '')
    .replace(/<!--\s*suggestions[\s\S]*?-->/gi, '')
    .replace(/<!--\s*requires_approval[\s\S]*?-->/gi, '')
    .trim();
  if (!cleanContent) return null;

  return (
    <div className="mt-3 text-sm text-zinc-300 leading-relaxed font-normal">
      <ReactMarkdown
        components={{
          p: ({ node, ...props }) => <p className="my-2 leading-relaxed text-zinc-200" {...props} />,
          ul: ({ node, ...props }) => <ul className="my-2 space-y-1.5 list-disc list-outside pl-5 text-zinc-300" {...props} />,
          ol: ({ node, ...props }) => <ol className="my-2 space-y-1.5 list-decimal list-outside pl-5 text-zinc-300" {...props} />,
          li: ({ node, ...props }) => <li className="leading-relaxed pl-1" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-semibold text-zinc-100" {...props} />,
          h1: ({ node, ...props }) => <h1 className="text-lg font-bold text-zinc-100 mt-4 mb-2" {...props} />,
          h2: ({ node, ...props }) => <h2 className="text-base font-semibold text-zinc-100 mt-3 mb-1.5" {...props} />,
          h3: ({ node, ...props }) => <h3 className="text-sm font-semibold text-zinc-100 mt-2 mb-1" {...props} />,
          pre: ({ children }) => <>{children}</>,
          code: ({ node, inline, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : '';
            const codeString = String(children || '').replace(/\n$/, '');

            if (inline || (!match && !codeString.includes('\n'))) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-200 font-mono text-[12.5px] border border-white/5" {...props}>
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock language={lang || 'text'} code={codeString} />
            );
          },
          blockquote: ({ node, ...props }) => (
            <blockquote className="border-l-2 border-indigo-500/50 pl-3 my-2 text-zinc-400 italic" {...props} />
          ),
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
};
