import { lazy, memo, Suspense } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

const CodeBlock = lazy(() => import('./codeBlock'));

function detectLanguage(className) {
  if (!className) return null;
  const m = className.match(/language-(\w+)/);
  return m ? m[1] : null;
}

const codeRenderer = (variant) => function CodeRenderer({ className, children, ...props }) {
  const inline = !className;
  const language = detectLanguage(className);
  const value = String(children).replace(/\n$/, '');
  if (inline) {
    if (variant === 'dispatch') {
      return <code {...props}>{children}</code>;
    }
    return (
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  }
  return (
    <Suspense
      fallback={
        <pre className="my-3 overflow-x-auto rounded-lg border bg-[#0d1117] p-3 text-sm">
          <code>{value}</code>
        </pre>
      }
    >
      <CodeBlock language={language} value={value} />
    </Suspense>
  );
};

const styledComponents = {
  p: ({ children }) => <p className="my-2 leading-7">{children}</p>,
  ul: ({ children }) => <ul className="my-2 ml-6 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-6 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  h1: ({ children }) => <h1 className="mt-4 mb-2 text-2xl font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 text-xl font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-lg font-semibold">{children}</h3>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-4 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted/30 px-3 py-1.5 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-1.5">{children}</td>
  ),
  hr: () => <hr className="my-4 border-border" />,
};

const dispatchComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

const MarkdownMessage = memo(function MarkdownMessage({ children, className }) {
  const variant = className?.includes('dispatch-body') ? 'dispatch' : 'default';
  const base = variant === 'dispatch' ? dispatchComponents : styledComponents;
  const components = { ...base, code: codeRenderer(variant) };

  return (
    <div className={cn('break-words', className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
});

export default MarkdownMessage;
