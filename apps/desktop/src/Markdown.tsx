import ReactMarkdown from "react-markdown";

export interface MarkdownProps {
  /** Markdown content to render */
  children: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Renders markdown content with consistent styling.
 *
 * Supports: bold, italic, lists, links, code blocks, headers, blockquotes.
 * XSS-safe: react-markdown does not render raw HTML by default.
 */
export function Markdown({ children, className = "" }: MarkdownProps) {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        components={{
          // Headers
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mt-6 mb-3 text-gray-900 dark:text-gray-100">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mt-5 mb-2 text-gray-900 dark:text-gray-100">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mt-4 mb-2 text-gray-900 dark:text-gray-100">
              {children}
            </h3>
          ),
          // Paragraphs
          p: ({ children }) => (
            <p className="mb-3 leading-relaxed text-gray-700 dark:text-gray-300">
              {children}
            </p>
          ),
          // Bold and italic
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-900 dark:text-gray-100">
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          // Lists
          ul: ({ children }) => (
            <ul className="list-disc pl-6 mb-3 space-y-1 text-gray-700 dark:text-gray-300">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 mb-3 space-y-1 text-gray-700 dark:text-gray-300">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {children}
            </a>
          ),
          // Code
          code: ({ className, children }) => {
            // Check if this is a code block (has language class) or inline code
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <code className="block bg-gray-100 dark:bg-gray-700 p-3 rounded-lg overflow-x-auto font-mono text-sm text-gray-800 dark:text-gray-200">
                  {children}
                </code>
              );
            }
            return (
              <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono text-sm text-gray-800 dark:text-gray-200">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mb-3">{children}</pre>,
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-3 italic text-gray-600 dark:text-gray-400">
              {children}
            </blockquote>
          ),
          // Horizontal rule
          hr: () => (
            <hr className="my-6 border-gray-200 dark:border-gray-700" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
