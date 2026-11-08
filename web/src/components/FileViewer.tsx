import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  FileText,
  FileCode,
  FileImage,
  Film,
  Music,
  BookOpen,
  Terminal,
  FileQuestion,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Download,
  ExternalLink,
  Code2,
  Eye,
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { fetchFileContent, API_BASE_URL } from '../api';

export type FileCategory =
  | 'pdf'
  | 'image'
  | 'media'
  | 'markdown'
  | 'ipynb'
  | 'code'
  | 'fallback';

export function getFileCategory(filePath: string): FileCategory {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return 'fallback';

  if (ext === 'pdf') {
    return 'pdf';
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mp3', 'wav'].includes(ext)) {
    return 'media';
  }
  if (ext === 'md') {
    return 'markdown';
  }
  if (ext === 'ipynb') {
    return 'ipynb';
  }
  if (
    [
      'c', 'cpp', 'h', 'hpp', 'py', 'rs', 'ts', 'js', 'tsx', 'jsx',
      'sh', 'asm', 's', 'tex', 'json', 'toml', 'yaml', 'yml', 'css', 'html', 'txt'
    ].includes(ext)
  ) {
    return 'code';
  }

  return 'fallback';
}

/**
 * Returns the Prism syntax highlighting language identifier based on file extension.
 */
export function getSyntaxLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'rs':
      return 'rust';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'py':
      return 'python';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'js':
      return 'javascript';
    case 'jsx':
      return 'jsx';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'bash';
    case 'tex':
      return 'latex';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'toml':
      return 'toml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'asm':
    case 's':
      return 'armasm';
    case 'sql':
      return 'sql';
    default:
      return 'text';
  }
}

interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  execution_count?: number | null;
  outputs?: Array<{
    output_type?: string;
    name?: string;
    text?: string | string[];
    data?: {
      'text/plain'?: string | string[];
      'image/png'?: string;
      'image/jpeg'?: string;
      [key: string]: unknown;
    };
    traceback?: string[];
    execution_count?: number | null;
  }>;
}

interface NotebookData {
  cells?: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
}

interface FileViewerProps {
  filePath?: string | null;
  refreshTrigger?: number;
  fileSize?: number;
}

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\x1b]\[[0-?]*[ -/]*[@-~]/g, '');
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 text-xs font-mono bg-gray-800 text-blue-300 rounded border border-gray-700/50"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold text-gray-100">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('[') && token.includes('](')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a
            key={match.index}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function renderMarkdownNodes(mdText: string): React.ReactNode[] {
  const lines = mdText.split('\n');
  const nodes: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        const code = codeBlockLines.join('\n');
        nodes.push(
          <div
            key={`code-${i}`}
            className="my-3 rounded-lg overflow-hidden border border-gray-800 bg-gray-900/90"
          >
            {codeBlockLang && (
              <div className="px-3 py-1 bg-gray-800/60 border-b border-gray-800 text-[11px] font-mono text-gray-400">
                {codeBlockLang}
              </div>
            )}
            <SyntaxHighlighter
              language={codeBlockLang || 'text'}
              style={vscDarkPlus}
              showLineNumbers={false}
              customStyle={{
                margin: 0,
                padding: '0.75rem',
                backgroundColor: 'transparent',
                fontSize: '0.8125rem',
              }}
            >
              {code}
            </SyntaxHighlighter>
          </div>
        );
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = '';
      } else {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    if (/^(---|___|\*\*\*)$/.test(line.trim())) {
      nodes.push(<hr key={`hr-${i}`} className="my-4 border-gray-800" />);
      continue;
    }

    if (line.startsWith('# ')) {
      nodes.push(
        <h1
          key={`h1-${i}`}
          className="text-xl font-bold text-gray-100 mt-5 mb-2 pb-1 border-b border-gray-800"
        >
          {formatInline(line.slice(2))}
        </h1>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(
        <h2
          key={`h2-${i}`}
          className="text-lg font-bold text-gray-100 mt-4 mb-2 pb-1 border-b border-gray-800/60"
        >
          {formatInline(line.slice(3))}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3-${i}`} className="text-base font-semibold text-gray-200 mt-3 mb-1.5">
          {formatInline(line.slice(4))}
        </h3>
      );
      continue;
    }
    if (line.startsWith('#### ')) {
      nodes.push(
        <h4 key={`h4-${i}`} className="text-sm font-semibold text-gray-300 mt-2 mb-1">
          {formatInline(line.slice(5))}
        </h4>
      );
      continue;
    }

    if (line.startsWith('> ')) {
      nodes.push(
        <blockquote
          key={`bq-${i}`}
          className="border-l-4 border-blue-500/50 bg-gray-900/40 pl-3 py-1 my-2 text-sm text-gray-300 italic rounded-r"
        >
          {formatInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    if (/^[\*\-\+]\s+/.test(line)) {
      nodes.push(
        <li key={`li-${i}`} className="text-sm text-gray-300 ml-5 list-disc leading-relaxed">
          {formatInline(line.replace(/^[\*\-\+]\s+/, ''))}
        </li>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      nodes.push(
        <li key={`nli-${i}`} className="text-sm text-gray-300 ml-5 list-decimal leading-relaxed">
          {formatInline(line.replace(/^\d+\.\s+/, ''))}
        </li>
      );
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    nodes.push(
      <p key={`p-${i}`} className="text-sm text-gray-300 my-1.5 leading-relaxed">
        {formatInline(line)}
      </p>
    );
  }

  return nodes;
}

export const FileViewer: React.FC<FileViewerProps> = ({
  filePath,
  refreshTrigger,
  fileSize,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');
  const [forceTextView, setForceTextView] = useState(false);

  const category = useMemo<FileCategory>(() => {
    if (!filePath) return 'fallback';
    if (forceTextView) return 'code';
    return getFileCategory(filePath);
  }, [filePath, forceTextView]);

  const catUrl = useMemo(() => {
    if (!filePath) return '';
    const normalized = filePath.trim().replace(/^\/+/, '');
    return `${API_BASE_URL}/api/v1/fs/cat?path=${encodeURIComponent(normalized)}`;
  }, [filePath]);

  const fileName = useMemo(() => {
    if (!filePath) return '';
    return filePath.split('/').pop() || filePath;
  }, [filePath]);

  const language = useMemo(() => {
    if (!filePath) return 'text';
    return getSyntaxLanguage(filePath);
  }, [filePath]);

  // Reset view settings when filePath changes
  useEffect(() => {
    setForceTextView(false);
    setViewMode('formatted');
  }, [filePath]);

  const shouldFetchText =
    category === 'code' ||
    category === 'markdown' ||
    category === 'ipynb' ||
    forceTextView;

  const loadTextContent = useCallback(async () => {
    if (!filePath || !shouldFetchText) {
      setContent(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const text = await fetchFileContent(filePath);
      setContent(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch file content');
      setContent(null);
    } finally {
      setLoading(false);
    }
  }, [filePath, shouldFetchText]);

  useEffect(() => {
    loadTextContent();
  }, [loadTextContent, refreshTrigger]);

  const handleCopy = async () => {
    if (content === null) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const formattedSize = useMemo(() => {
    if (fileSize == null) return null;
    if (fileSize < 1024) return `${fileSize} B`;
    if (fileSize < 1024 * 1024) return `${(fileSize / 1024).toFixed(1)} KB`;
    return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
  }, [fileSize]);

  if (!filePath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500 bg-gray-950">
        <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center mb-4 text-gray-400">
          <Terminal className="w-8 h-8" />
        </div>
        <h3 className="text-base font-medium text-gray-300 mb-1">No file selected</h3>
        <p className="text-sm max-w-sm text-gray-500">
          Choose a file from the workspace tree on the left to preview code, notebooks, documents, or media in real-time.
        </p>
      </div>
    );
  }

  const lines = content !== null ? content.split('\n') : [];

  const getCategoryIcon = () => {
    switch (category) {
      case 'code':
        return <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'markdown':
        return <BookOpen className="w-4 h-4 text-sky-400 shrink-0" />;
      case 'ipynb':
        return <Terminal className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'pdf':
        return <FileText className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'image':
        return <FileImage className="w-4 h-4 text-purple-400 shrink-0" />;
      case 'media': {
        const ext = filePath.split('.').pop()?.toLowerCase();
        return ext === 'mp3' || ext === 'wav' ? (
          <Music className="w-4 h-4 text-pink-400 shrink-0" />
        ) : (
          <Film className="w-4 h-4 text-indigo-400 shrink-0" />
        );
      }
      default:
        return <FileQuestion className="w-4 h-4 text-gray-400 shrink-0" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Header bar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-gray-800 bg-gray-900/60 shrink-0">
        <div className="flex items-center gap-2 overflow-hidden">
          {getCategoryIcon()}
          <span className="font-mono text-sm text-gray-200 truncate" title={filePath}>
            {filePath}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-gray-800 border border-gray-700/60 text-gray-400 shrink-0 ml-1">
            {category}
          </span>
          {language !== 'text' && category === 'code' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 shrink-0">
              {language}
            </span>
          )}
          {lines.length > 0 && shouldFetchText && (
            <span className="text-xs text-gray-500 shrink-0 ml-2 hidden sm:inline">
              {lines.length} {lines.length === 1 ? 'line' : 'lines'}
            </span>
          )}
          {formattedSize && (
            <span className="text-xs text-gray-500 shrink-0 ml-1 hidden sm:inline">
              ({formattedSize})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Markdown / Notebook View Mode Toggle */}
          {(category === 'markdown' || category === 'ipynb') && !forceTextView && (
            <div className="flex items-center rounded-lg bg-gray-800/80 p-0.5 border border-gray-700/60 mr-1 text-xs">
              <button
                onClick={() => setViewMode('formatted')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors ${
                  viewMode === 'formatted'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>Preview</span>
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Code2 className="w-3 h-3" />
                <span>Raw</span>
              </button>
            </div>
          )}

          {/* Reload button */}
          <button
            onClick={() => loadTextContent()}
            disabled={loading}
            title="Reload file"
            className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Copy button */}
          {shouldFetchText && (
            <button
              onClick={handleCopy}
              disabled={content === null || loading}
              title={copied ? 'Copied!' : 'Copy raw content'}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}

          {/* Open/Download Link */}
          <a
            href={catUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open raw file in new tab"
            className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Main content body */}
      <div className="flex-1 overflow-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-gray-950/70 backdrop-blur-sm flex items-center justify-center gap-2 text-sm text-gray-400 z-10">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span>Loading {fileName}...</span>
          </div>
        )}

        {error && (
          <div className="p-8 max-w-lg mx-auto mt-8 bg-red-950/30 border border-red-800/60 rounded-xl text-center">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-red-300 mb-1">Failed to read file</h4>
            <p className="text-xs text-red-400/80 mb-4 font-mono break-all">{error}</p>
            <button
              onClick={() => loadTextContent()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-200 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* 1. PDF Viewer */}
            {category === 'pdf' && (
              <div className="w-full h-full bg-gray-900">
                <iframe
                  src={catUrl}
                  title={fileName}
                  className="w-full h-full border-none"
                />
              </div>
            )}

            {/* 2. Image Viewer */}
            {category === 'image' && (
              <div className="flex-1 w-full h-full flex items-center justify-center p-6 overflow-auto bg-gray-950/80">
                <img
                  src={catUrl}
                  alt={fileName}
                  className="max-w-full max-h-full object-contain rounded-lg border border-gray-800 shadow-2xl bg-gray-900/40"
                />
              </div>
            )}

            {/* 3. Media Viewer (Audio / Video) */}
            {category === 'media' && (
              <div className="flex-1 w-full h-full flex items-center justify-center p-6 overflow-auto bg-gray-950">
                {filePath.endsWith('.mp3') || filePath.endsWith('.wav') ? (
                  <div className="w-full max-w-md p-6 rounded-2xl bg-gray-900/80 border border-gray-800 flex flex-col items-center gap-4 shadow-xl">
                    <div className="w-16 h-16 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
                      <Music className="w-8 h-8" />
                    </div>
                    <div className="text-center">
                      <h4 className="text-sm font-semibold text-gray-200 truncate max-w-xs">
                        {fileName}
                      </h4>
                      <p className="text-xs text-gray-500 mt-0.5 font-mono">{filePath}</p>
                    </div>
                    <audio controls src={catUrl} className="w-full mt-2" />
                  </div>
                ) : (
                  <video
                    controls
                    src={catUrl}
                    className="max-w-full max-h-full rounded-xl border border-gray-800 shadow-2xl bg-black"
                  >
                    Your browser does not support the video tag.
                  </video>
                )}
              </div>
            )}

            {/* 4. Markdown Viewer */}
            {category === 'markdown' && content !== null && (
              viewMode === 'formatted' ? (
                <div className="p-6 md:p-8 max-w-4xl mx-auto overflow-y-auto">
                  <div className="prose prose-invert max-w-none">
                    {renderMarkdownNodes(content)}
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-auto bg-gray-950 font-mono text-sm">
                  <SyntaxHighlighter
                    language="markdown"
                    style={vscDarkPlus}
                    showLineNumbers={true}
                    wrapLines={true}
                    customStyle={{
                      margin: 0,
                      padding: '1rem',
                      backgroundColor: '#030712',
                      fontSize: '0.875rem',
                      lineHeight: '1.5rem',
                    }}
                    lineNumberStyle={{
                      minWidth: '2.5rem',
                      paddingRight: '1rem',
                      color: '#4b5563',
                      userSelect: 'none',
                    }}
                  >
                    {content}
                  </SyntaxHighlighter>
                </div>
              )
            )}

            {/* 5. Jupyter Notebook Viewer */}
            {category === 'ipynb' && content !== null && (
              viewMode === 'formatted' ? (
                <JupyterNotebookViewer content={content} />
              ) : (
                <div className="flex-1 overflow-auto bg-gray-950 font-mono text-sm">
                  <SyntaxHighlighter
                    language="json"
                    style={vscDarkPlus}
                    showLineNumbers={true}
                    wrapLines={true}
                    customStyle={{
                      margin: 0,
                      padding: '1rem',
                      backgroundColor: '#030712',
                      fontSize: '0.875rem',
                      lineHeight: '1.5rem',
                    }}
                    lineNumberStyle={{
                      minWidth: '2.5rem',
                      paddingRight: '1rem',
                      color: '#4b5563',
                      userSelect: 'none',
                    }}
                  >
                    {content}
                  </SyntaxHighlighter>
                </div>
              )
            )}

            {/* 6. Code & Text Viewer with SyntaxHighlighter */}
            {category === 'code' && content !== null && (
              <div className="flex-1 overflow-auto bg-gray-950 font-mono text-sm">
                <SyntaxHighlighter
                  language={language}
                  style={vscDarkPlus}
                  showLineNumbers={true}
                  wrapLines={true}
                  customStyle={{
                    margin: 0,
                    padding: '1rem',
                    backgroundColor: '#030712',
                    fontSize: '0.875rem',
                    lineHeight: '1.5rem',
                  }}
                  lineNumberStyle={{
                    minWidth: '2.5rem',
                    paddingRight: '1rem',
                    color: '#4b5563',
                    userSelect: 'none',
                  }}
                >
                  {content}
                </SyntaxHighlighter>
              </div>
            )}

            {/* 7. Fallback Card for Unrecognized Binary / Non-Text Files */}
            {category === 'fallback' && (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gray-950">
                <div className="w-full max-w-md p-8 rounded-2xl bg-gray-900/60 border border-gray-800 flex flex-col items-center shadow-xl">
                  <div className="w-16 h-16 rounded-2xl bg-gray-800/60 border border-gray-700/50 flex items-center justify-center text-gray-400 mb-4">
                    <FileQuestion className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-200 mb-1 truncate max-w-xs">
                    {fileName}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono mb-2 break-all">{filePath}</p>
                  {formattedSize && (
                    <span className="text-xs text-gray-400 mb-4 font-mono">
                      Size: {formattedSize}
                    </span>
                  )}
                  <div className="text-xs text-gray-400 mb-6 bg-gray-800/40 px-3 py-1.5 rounded-md border border-gray-700/40">
                    Binary or unsupported file format preview
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <a
                      href={catUrl}
                      download={fileName}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                    <a
                      href={catUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-medium transition-colors border border-gray-700/60"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Raw</span>
                    </a>
                    <button
                      onClick={() => setForceTextView(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-medium transition-colors border border-gray-700/60"
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      <span>View as Text</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Subcomponent to render Jupyter Notebooks (.ipynb)
 */
function JupyterNotebookViewer({ content }: { content: string }) {
  const notebook = useMemo<NotebookData | null>(() => {
    try {
      return JSON.parse(content);
    } catch (err) {
      console.error('Failed to parse notebook JSON:', err);
      return null;
    }
  }, [content]);

  if (!notebook || !notebook.cells) {
    return (
      <div className="p-8 text-center text-sm text-red-400 bg-red-950/20 border border-red-900/40 rounded-xl m-6">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-400" />
        <p className="font-semibold">Invalid Jupyter Notebook format</p>
        <p className="text-xs text-red-400/80 mt-1 font-mono">
          Could not parse JSON cells from this .ipynb file.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {notebook.cells.map((cell, idx) => {
        const sourceText = Array.isArray(cell.source) ? cell.source.join('') : cell.source || '';

        if (cell.cell_type === 'markdown') {
          return (
            <div
              key={idx}
              className="p-3 rounded-lg bg-gray-900/40 border border-gray-800/80 border-l-4 border-l-purple-500/60"
            >
              {renderMarkdownNodes(sourceText)}
            </div>
          );
        }

        if (cell.cell_type === 'code') {
          return (
            <div key={idx} className="space-y-1.5">
              {/* Code input cell with syntax highlighting */}
              <div className="flex items-start gap-2">
                <span className="text-[11px] font-mono text-cyan-400/80 pt-2 select-none w-14 shrink-0 text-right">
                  In [{cell.execution_count ?? ' '}]:
                </span>
                <div className="flex-1 rounded-lg bg-gray-900 border border-gray-800 overflow-hidden shadow-inner">
                  <SyntaxHighlighter
                    language="python"
                    style={vscDarkPlus}
                    showLineNumbers={false}
                    wrapLines={true}
                    customStyle={{
                      margin: 0,
                      padding: '0.75rem',
                      backgroundColor: 'transparent',
                      fontSize: '0.8125rem',
                      lineHeight: '1.4rem',
                    }}
                  >
                    {sourceText}
                  </SyntaxHighlighter>
                </div>
              </div>

              {/* Outputs */}
              {cell.outputs && cell.outputs.length > 0 && (
                <div className="space-y-1 mt-1">
                  {cell.outputs.map((out, outIdx) => {
                    const textOut = out.text
                      ? Array.isArray(out.text)
                        ? out.text.join('')
                        : out.text
                      : out.data && out.data['text/plain']
                      ? Array.isArray(out.data['text/plain'])
                        ? out.data['text/plain'].join('')
                        : String(out.data['text/plain'])
                      : null;

                    const imagePng = out.data && out.data['image/png'];
                    const imageJpeg = out.data && out.data['image/jpeg'];
                    const rawImage = typeof imagePng === 'string' ? imagePng : typeof imageJpeg === 'string' ? imageJpeg : null;

                    const traceback = out.traceback && Array.isArray(out.traceback)
                      ? stripAnsi(out.traceback.join('\n'))
                      : null;

                    return (
                      <div key={outIdx} className="flex items-start gap-2">
                        <span className="text-[11px] font-mono text-amber-400/80 pt-1 select-none w-14 shrink-0 text-right">
                          {out.execution_count != null ? `Out [${out.execution_count}]:` : ''}
                        </span>
                        <div className="flex-1 overflow-x-auto space-y-1">
                          {textOut && (
                            <pre className="p-2.5 rounded bg-gray-950/80 border border-gray-800/60 font-mono text-xs text-gray-300 whitespace-pre m-0">
                              {textOut}
                            </pre>
                          )}
                          {rawImage && (
                            <div className="p-2 bg-gray-900/60 rounded border border-gray-800 inline-block">
                              <img
                                src={`data:image/png;base64,${rawImage.trim()}`}
                                alt="Notebook output visualization"
                                className="max-w-full rounded"
                              />
                            </div>
                          )}
                          {traceback && (
                            <pre className="p-2.5 rounded bg-rose-950/20 border border-rose-900/40 font-mono text-xs text-rose-300 whitespace-pre m-0">
                              {traceback}
                            </pre>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        // Raw cells
        return (
          <div key={idx} className="p-3 rounded bg-gray-900/30 border border-gray-800">
            <pre className="font-mono text-xs text-gray-400 whitespace-pre m-0">
              {sourceText}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
