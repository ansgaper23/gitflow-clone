import React from 'react';
import ReactMarkdown from 'react-markdown';

export const ResolutionSummary = ({ content }) => {
  if (!content) return null;
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
          code: ({ node, inline, ...props }) => (
            <code className="bg-zinc-800 text-zinc-200 px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-700/50" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="border-l-2 border-indigo-500/50 pl-3 my-2 text-zinc-400 italic" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

