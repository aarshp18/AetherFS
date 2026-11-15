import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileCode,
  FileText,
  File,
  Image as FileImage,
  Film,
  Music,
  Terminal,
  Loader2,
  AlertCircle,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { FsItem } from '../types';
import { fetchDirectory, API_BASE_URL } from '../api';

export interface FileExplorerProps {
  onSelectFile: (path: string) => void;
  selectedFile?: string | null;
  refreshTrigger?: number;
}

interface ExplorerNodeProps {
  item: FsItem;
  depth: number;
  selectedFile?: string | null;
  currentPath: string;
  onSelectFile: (path: string) => void;
  onSelectDir: (path: string) => void;
  refreshTrigger?: number;
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'rs':
    case 'py':
    case 'json':
    case 'toml':
    case 'html':
    case 'css':
    case 'yaml':
    case 'yml':
    case 'sh':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'asm':
    case 's':
    case 'tex':
      return <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />;
    case 'ipynb':
      return <Terminal className="w-4 h-4 text-amber-400 shrink-0" />;
    case 'pdf':
      return <FileText className="w-4 h-4 text-rose-400 shrink-0" />;
    case 'md':
    case 'txt':
    case 'log':
      return <FileText className="w-4 h-4 text-sky-400 shrink-0" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return <FileImage className="w-4 h-4 text-purple-400 shrink-0" />;
    case 'mp4':
    case 'webm':
      return <Film className="w-4 h-4 text-indigo-400 shrink-0" />;
    case 'mp3':
    case 'wav':
      return <Music className="w-4 h-4 text-pink-400 shrink-0" />;
    default:
      return <File className="w-4 h-4 text-gray-400 shrink-0" />;
  }
}

export const ExplorerNode: React.FC<ExplorerNodeProps> = ({
  item,
  depth,
  selectedFile,
  currentPath,
  onSelectFile,
  onSelectDir,
  refreshTrigger,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<FsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchDirectory(item.path);
      setChildren(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, [item.path]);

  useEffect(() => {
    if (item.is_dir && isExpanded) {
      loadChildren();
    }
  }, [item.is_dir, isExpanded, refreshTrigger, loadChildren]);

  const handleToggle = () => {
    if (item.is_dir) {
      setIsExpanded((prev) => !prev);
      onSelectDir(item.path);
    } else {
      onSelectFile(item.path);
      const parentDir = item.path.includes('/')
        ? item.path.slice(0, item.path.lastIndexOf('/'))
        : '';
      onSelectDir(parentDir);
    }
  };

  const isSelected = selectedFile === item.path || (item.is_dir && currentPath === item.path);

  return (
    <div>
      <button
        onClick={handleToggle}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={`w-full flex items-center gap-1.5 py-1 px-2 text-left text-sm rounded transition-colors group ${
          isSelected
            ? 'bg-blue-600/20 text-blue-400 font-medium'
            : 'text-gray-300 hover:bg-gray-800/60 hover:text-gray-100'
        }`}
      >
        {item.is_dir ? (
          <>
            <span className="text-gray-400 group-hover:text-gray-200 shrink-0">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-blue-400 shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            {getFileIcon(item.name)}
          </>
        )}
        <span className="truncate flex-1">{item.name}</span>
        {loading && <Loader2 className="w-3 h-3 text-gray-500 animate-spin shrink-0" />}
      </button>

      {item.is_dir && isExpanded && (
        <div className="flex flex-col">
          {error && (
            <div
              style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
              className="flex items-center gap-1 py-1 text-xs text-red-400"
            >
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}
          {!loading && !error && children.length === 0 && (
            <div
              style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
              className="py-1 text-xs text-gray-500 italic"
            >
              (empty)
            </div>
          )}
          {children.map((child) => (
            <ExplorerNode
              key={child.path}
              item={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              currentPath={currentPath}
              onSelectFile={onSelectFile}
              onSelectDir={onSelectDir}
              refreshTrigger={refreshTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileExplorer: React.FC<FileExplorerProps> = ({
  onSelectFile,
  selectedFile,
  refreshTrigger,
}) => {
  const [rootItems, setRootItems] = useState<FsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [localRefresh, setLocalRefresh] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchDirectory('');
      setRootItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to workspace');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoot();
  }, [loadRoot, refreshTrigger, localRefresh]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(
        `${API_BASE_URL}/api/v1/fs/upload?path=${encodeURIComponent(currentPath)}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!res.ok) {
        throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      }

      setLocalRefresh((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload file');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden select-none">
      {/* Header Controls */}
      <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-800 gap-2">
        <button
          onClick={() => setCurrentPath('')}
          title="Select workspace root"
          className="truncate hover:text-gray-200 transition-colors text-left"
        >
          Files {currentPath ? `(${currentPath})` : ''}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title={
              currentPath
                ? `Upload file to /${currentPath}`
                : 'Upload file to workspace root'
            }
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium normal-case tracking-normal bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            ) : (
              <Upload className="w-3 h-3 shrink-0" />
            )}
            <span>Upload File</span>
          </button>

          <button
            onClick={() => loadRoot()}
            title="Refresh files"
            className="p-1 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tree Body */}
      <div className="flex-1 overflow-y-auto py-2 px-1">
        {loading && rootItems.length === 0 && (
          <div className="flex items-center justify-center p-6 text-sm text-gray-400 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span>Loading workspace...</span>
          </div>
        )}

        {error && (
          <div className="p-3 m-2 text-xs text-red-300 bg-red-950/40 border border-red-800/60 rounded flex flex-col gap-2">
            <div className="flex items-center gap-1.5 font-medium text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Workspace Error</span>
            </div>
            <p className="break-words">{error}</p>
            <button
              onClick={() => loadRoot()}
              className="self-start px-2 py-1 text-xs bg-red-900/40 hover:bg-red-800/50 text-red-200 rounded transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && rootItems.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500 italic">
            Workspace is empty
          </div>
        )}

        {rootItems.map((item) => (
          <ExplorerNode
            key={item.path}
            item={item}
            depth={0}
            selectedFile={selectedFile}
            currentPath={currentPath}
            onSelectFile={onSelectFile}
            onSelectDir={setCurrentPath}
            refreshTrigger={(refreshTrigger || 0) + localRefresh}
          />
        ))}
      </div>
    </div>
  );
};

export default FileExplorer;
