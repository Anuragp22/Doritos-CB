import { useState } from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async-light';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import { Check, Copy } from 'lucide-react';

const aliases = {
  javascript,
  js: javascript,
  typescript,
  ts: typescript,
  jsx,
  tsx,
  python,
  py: python,
  bash,
  sh: bash,
  shell: bash,
  json,
  yaml,
  yml: yaml,
  markup,
  html: markup,
  xml: markup,
  css,
  sql,
  go,
  rust,
  markdown,
  md: markdown,
};

for (const [name, mod] of Object.entries(aliases)) {
  SyntaxHighlighter.registerLanguage(name, mod);
}

export default function CodeBlock({ language, value }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden border border-ink bg-ink">
      <div className="flex items-center justify-between border-b border-paper/15 bg-paper/5 px-3 py-1.5 font-mono text-xs text-paper/70">
        <span>{language || 'text'}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 px-2 py-0.5 transition-colors hover:bg-paper/10 hover:text-paper"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '0.75rem 1rem',
          background: 'transparent',
          fontSize: '0.875rem',
        }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, monospace' } }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}
