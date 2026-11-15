import React, { useState, useEffect, useCallback } from 'react';
import {
  Clipboard,
  UploadCloud,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { API_BASE_URL } from '../api';

export const NetworkClipboard: React.FC = () => {
  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [pushing, setPushing] = useState<boolean>(false);
  const [pushed, setPushed] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClipboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/clipboard`);
      if (!res.ok) {
        throw new Error(`Failed to fetch clipboard: ${res.status} ${res.statusText}`);
      }
      const data = await res.text();
      setText(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch clipboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClipboard();
  }, [fetchClipboard]);

  const handlePushToNetwork = async () => {
    setPushing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/clipboard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: text,
      });
      if (!res.ok) {
        throw new Error(`Failed to push clipboard: ${res.status} ${res.statusText}`);
      }
      setPushed(true);
      setTimeout(() => setPushed(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to push clipboard');
    } finally {
      setPushing(false);
    }
  };

  const handleCopyToDevice = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy to device clipboard');
    }
  };

  return (
    <div className="flex flex-col bg-gray-900/95 border border-gray-800 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2">
          <Clipboard className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-200">
            Network Clipboard
          </span>
        </div>
        <button
          onClick={fetchClipboard}
          disabled={loading}
          title="Pull latest from network clipboard"
          className="p-1 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-2.5">
        {error && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-300 bg-red-950/40 border border-red-800/60 rounded">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type text here to share across connected devices..."
          rows={5}
          className="w-full p-2.5 text-xs font-mono bg-gray-950 text-gray-100 placeholder-gray-600 border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500/60 resize-y"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={handlePushToNetwork}
            disabled={pushing || loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
          >
            {pushing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : pushed ? (
              <Check className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <UploadCloud className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{pushed ? 'Pushed!' : 'Push to Network'}</span>
          </button>

          <button
            onClick={handleCopyToDevice}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700/60 transition-colors disabled:opacity-50"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{copied ? 'Copied!' : 'Copy to Device'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default NetworkClipboard;
