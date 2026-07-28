import type * as React from 'react';

export interface MessageRendererProps {
  readonly content: string;
}

function parseInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map(part => {
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) return <strong key={`inline-bold-${boldMatch[1]}`}>{boldMatch[1]}</strong>;
    return part;
  });
}

function parseBlocks(content: string): React.ReactNode[] {
  const parts = content.split(/(```[\w]*\n[\s\S]*?```)/g);
  return parts.map(part => {
    const fenceMatch = part.match(/^```([\w]*)\n([\s\S]*?)```$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || 'text';
      const code = fenceMatch[2];
      return (
        <pre
          key={`code-${lang}-${code.slice(0, 20)}`}
          className="bg-muted my-2 overflow-x-auto rounded p-3 text-sm"
        >
          <code className={`language-${lang}`}>{code}</code>
        </pre>
      );
    }
    return (
      <span key={`text-${part.slice(0, 20)}`} className="whitespace-pre-wrap">
        {parseInline(part)}
      </span>
    );
  });
}

export function MessageRenderer({ content }: MessageRendererProps): React.ReactElement {
  return <div className="text-sm leading-relaxed">{parseBlocks(content)}</div>;
}
