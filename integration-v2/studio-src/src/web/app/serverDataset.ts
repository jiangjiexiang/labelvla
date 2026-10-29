import type { DataSource } from '../../core/datasource/types';

export class ServerSource implements DataSource {
  private dataset: string;
  private files: Set<string>;
  constructor(dataset: string, files: Set<string>) {
    this.dataset = dataset;
    this.files = files;
  }
  private url(path: string) {
    return `/api/bridge/file?dataset=${encodeURIComponent(this.dataset)}&path=${encodeURIComponent(path)}`;
  }
  async exists(path: string) {
    return this.files.has(path.replace(/^\.\//, ''));
  }
  async listPaths() {
    return [...this.files];
  }
  async readBytes(path: string) {
    const r = await fetch(this.url(path));
    if (!r.ok) throw new Error(`读取失败 ${path}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async readText(path: string) {
    return new TextDecoder().decode(await this.readBytes(path));
  }
  async getObjectUrl(path: string) {
    return this.url(path);
  }
  clear() {}
}

export type ServerDatasetEntry = { name: string; path: string };

export async function fetchServerDatasets(
  path = '/data',
  depth = 3,
): Promise<ServerDatasetEntry[]> {
  const response = await fetch(
    `/api/datasets?path=${encodeURIComponent(path)}&depth=${depth}`,
  );
  if (!response.ok) {
    throw new Error((await response.json().catch(() => ({}))).detail || '无法扫描服务器数据集');
  }
  const data = (await response.json()) as { datasets?: ServerDatasetEntry[] };
  return data.datasets ?? [];
}

export async function connectServerDataset(
  dataset: string,
  initialize: (source: DataSource) => Promise<void>,
  setAnnotationDataset?: (path: string) => void,
): Promise<{ name: string }> {
  const response = await fetch(`/api/bridge/index?dataset=${encodeURIComponent(dataset)}`);
  if (!response.ok) {
    throw new Error((await response.json().catch(() => ({}))).detail || '无法读取数据集');
  }
  const data = (await response.json()) as { files: string[] };
  const source = new ServerSource(dataset, new Set(data.files));
  const meta = JSON.parse(await source.readText('meta/info.json')) as {
    codebase_version?: string;
  };
  setAnnotationDataset?.('');
  await initialize(source);
  const version = String(meta.codebase_version || '');
  if (version.startsWith('v2') || version.startsWith('v3')) {
    setAnnotationDataset?.(dataset);
  }
  return { name: dataset.split('/').filter(Boolean).pop() || dataset };
}
