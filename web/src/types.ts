export interface FsItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: number;
}

export interface FsEvent {
  kind: 'create' | 'modify' | 'remove' | 'other' | string;
  path: string;
}

export interface LsEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export interface LsResponse {
  path: string;
  entries: LsEntry[];
}
