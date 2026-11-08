import { FsItem, LsResponse } from './types';

const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
export const API_BASE_URL = `http://${host}:8080`;

/**
 * Fetches the contents of a directory given a workspace-relative path.
 * Maps LsResponse entries to FsItem objects with workspace-relative paths.
 */
export async function fetchDirectory(path: string = ''): Promise<FsItem[]> {
  const normalizedPath = path.trim().replace(/^\/+/, '');
  const url = `${API_BASE_URL}/api/v1/fs/ls?path=${encodeURIComponent(normalizedPath)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch directory "${path}": ${res.status} ${res.statusText}`);
  }

  const data: LsResponse = await res.json();

  const items: FsItem[] = data.entries.map((entry) => {
    const itemPath = normalizedPath
      ? `${normalizedPath.replace(/\/+$/, '')}/${entry.name}`
      : entry.name;

    return {
      name: entry.name,
      path: itemPath,
      is_dir: entry.is_dir,
      size: entry.size,
      modified: entry.modified,
    };
  });

  // Sort directories first, then alphabetical by name
  return items.sort((a, b) => {
    if (a.is_dir === b.is_dir) {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }
    return a.is_dir ? -1 : 1;
  });
}

/**
 * Fetches raw file content given a workspace-relative path.
 */
export async function fetchFileContent(path: string): Promise<string> {
  const normalizedPath = path.trim().replace(/^\/+/, '');
  const url = `${API_BASE_URL}/api/v1/fs/cat?path=${encodeURIComponent(normalizedPath)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch file content for "${path}": ${res.status} ${res.statusText}`);
  }

  return await res.text();
}
