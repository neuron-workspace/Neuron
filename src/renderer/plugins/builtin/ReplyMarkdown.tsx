import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Model replies, rendered as Markdown.
 *
 * They used to go into a `<pre>`, so a reply came back with its syntax still
 * showing: literal asterisks, pipe characters where a table should be, and
 * fenced code blocks as rows of backticks. Models write Markdown because they
 * are asked to; showing it raw wastes the formatting they produced.
 *
 * NOT the MDX pipeline the notes use. MDX evaluates JSX, and this is text a
 * remote service produced — the app must not be one prompt injection away from
 * running a component. `react-markdown` builds React elements from an AST and
 * never evaluates the source, and raw HTML is left off (no `rehype-raw`), so
 * anything HTML-shaped in a reply is shown as the text it is.
 */
export default function ReplyMarkdown({ source }: { source: string }) {
  return (
    <div className="reply-markdown break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Links open in the system browser through main's existing navigation
          // guard rather than moving the app frame.
          a: ({ children, href }) => (
            <a href={href} className="font-medium text-[var(--md-link)] underline underline-offset-2">{children}</a>
          ),
          code: ({ className, children }) => {
            const fenced = /language-/.test(className ?? '');
            return fenced ? (
              <code className="block overflow-x-auto rounded border border-[var(--divider)] bg-[var(--md-code-bg)] p-2 font-mono text-[11.5px] leading-5 text-[var(--md-code)]">{children}</code>
            ) : (
              <code className="rounded border border-[var(--divider)] bg-[var(--md-code-bg)] px-1 py-0.5 font-mono text-[11.5px] text-[var(--md-code)]">{children}</code>
            );
          },
          pre: ({ children }) => <pre className="my-2 overflow-x-auto">{children}</pre>,
          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mb-1 mt-3 text-[15px] font-semibold text-[var(--ink)] first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1 mt-3 text-[14px] font-semibold text-[var(--ink)] first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-[13px] font-semibold text-[var(--ink)] first:mt-0">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-[var(--divider)] pl-3 text-[var(--ink-muted)]">{children}</blockquote>
          ),
          // A table is why remark-gfm is here: without it a Markdown table is
          // rows of pipe characters.
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-[var(--divider)] px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-[var(--divider)] px-2 py-1">{children}</td>,
          hr: () => <hr className="my-3 border-[var(--divider)]" />,
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}
