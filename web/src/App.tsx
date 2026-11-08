import { useState, useCallback, useRef, useEffect } from 'react';
import { Layers, Radio, Activity } from 'lucide-react';
import { FileTree } from './components/FileTree';
import { FileViewer } from './components/FileViewer';
import { useEvents, isIgnoredPath } from './useEvents';
import { FsEvent } from './types';

export { isIgnoredPath };

export default function App() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [treeRefreshKey, setTreeRefreshKey] = useState<number>(0);
  const [fileRefreshKey, setFileRefreshKey] = useState<number>(0);
  const [lastEvent, setLastEvent] = useState<FsEvent | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 100ms debounce to directory refresh calls so rapid consecutive events don't spam GET /api/v1/fs/ls
  const refreshDirectory = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setTreeRefreshKey((prev) => prev + 1);
    }, 100);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Handle incoming real-time filesystem events from WebSocket
  const handleFsEvent = useCallback(
    (event: FsEvent) => {
      // Ignore background system/cache/build events before refreshing
      if (isIgnoredPath(event.path)) {
        return;
      }

      console.log('[AetherFS] Filesystem event received:', event);
      setLastEvent(event);

      // Trigger debounced directory refresh on create, modify, or remove events
      if (['create', 'modify', 'remove'].includes(event.kind)) {
        refreshDirectory();
      }

      // If the current file was modified or removed, reload or notify
      if (selectedFile && event.path === selectedFile) {
        setFileRefreshKey((prev) => prev + 1);
      }
    },
    [selectedFile, refreshDirectory],
  );

  const { isConnected } = useEvents(handleFsEvent);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 text-gray-100 font-sans">
      {/* Main Two-Column Layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar (280px) */}
        <aside className="w-72 md:w-80 border-r border-gray-800 bg-gray-900/40 flex flex-col shrink-0 select-none">
          {/* Header */}
          <div className="h-14 px-4 flex items-center justify-between border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-gray-100 tracking-tight leading-none">
                  AetherFS
                </h1>
                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">
                  Workspace Daemon
                </span>
              </div>
            </div>

            {/* Connection Status Badge */}
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                isConnected
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                  : 'bg-amber-950/40 border-amber-800/60 text-amber-400 animate-pulse'
              }`}
              title={
                isConnected
                  ? 'Connected to daemon real-time event engine'
                  : 'Disconnected. Attempting auto-reconnect...'
              }
            >
              <Radio className="w-3 h-3 shrink-0" />
              <span>{isConnected ? 'Live' : 'Offline'}</span>
            </div>
          </div>

          {/* Recursive File Tree */}
          <div className="flex-1 overflow-hidden">
            <FileTree
              onSelectFile={(path) => setSelectedFile(path)}
              selectedFile={selectedFile}
              refreshTrigger={treeRefreshKey}
            />
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-gray-950 overflow-hidden">
          <FileViewer filePath={selectedFile} refreshTrigger={fileRefreshKey} />
        </main>
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-6 px-3 bg-gray-900 border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-400 select-none shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-400' : 'bg-amber-500 animate-pulse'
            }`}
          />
          <span>{isConnected ? 'Daemon: ws://127.0.0.1:8080' : 'Connecting to daemon...'}</span>
        </div>

        {lastEvent && (
          <div className="flex items-center gap-1.5 text-gray-400 truncate max-w-md">
            <Activity className="w-3 h-3 text-blue-400 shrink-0" />
            <span className="text-gray-500">Event:</span>
            <span className="text-blue-400 font-mono font-medium uppercase text-[10px]">
              {lastEvent.kind}
            </span>
            <span className="truncate font-mono text-gray-300">{lastEvent.path}</span>
          </div>
        )}
      </footer>
    </div>
  );
}
