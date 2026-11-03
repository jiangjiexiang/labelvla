import type { DatasetStats, ExportAdapter, ExportFormat } from '@/core';

export async function checked(response: Response): Promise<Response> {
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.detail || `保存失败 (${response.status})`);
  }
  return response;
}

/** Stream each generated file to an unpublished task draft, without a giant ZIP in memory. */
export class ServerExportAdapter implements ExportAdapter {
  private files = new Set<string>();
  dataset = '';
  readonly draftId: string;
  private signal?: AbortSignal;
  constructor(draftId: string, signal?: AbortSignal) { this.draftId = draftId; this.signal = signal; }
  async writeFile(path: string, content: Uint8Array) {
    await checked(await fetch(`/api/bridge/drafts/${this.draftId}/file?path=${encodeURIComponent(path)}`, {
      method: 'PUT', body: new Blob([new Uint8Array(content)]), signal: this.signal,
    }));
    this.files.add(path);
  }
  async readFile(path: string) {
    const result = await checked(await fetch(`/api/bridge/drafts/${this.draftId}/file?path=${encodeURIComponent(path)}`, { signal: this.signal }));
    return new Uint8Array(await result.arrayBuffer());
  }
  createDirectory(_path: string) {}
  hasFile(path: string) { return this.files.has(path); }
  listFiles() { return [...this.files]; }
  clear() { this.files.clear(); }
  async finalize(_format: ExportFormat) {
    const result = await checked(await fetch(`/api/bridge/drafts/${this.draftId}/finish`, { method: 'POST', signal: this.signal }));
    this.dataset = (await result.json()).dataset;
  }
  async computeVisualStats(episodeIndex: number, range: { startFrame: number; endFrame: number }, signal?: AbortSignal): Promise<DatasetStats> {
    const result = await checked(await fetch(`/api/bridge/drafts/${this.draftId}/visual-stats?episode=${episodeIndex}&start=${range.startFrame}&end=${range.endFrame}`, { signal: signal ?? this.signal }));
    return result.json();
  }
  async convertVideoSegment(bytes: Uint8Array, trim?: { fromSec?: number; toSec?: number }, signal?: AbortSignal) {
    const start = trim?.fromSec ?? 0;
    const end = trim?.toSec ?? 0;
    const result = await checked(await fetch(`/api/bridge/drafts/${this.draftId}/video?start=${start}&end=${end}`, {
      method: 'POST', body: new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), signal: signal ?? this.signal,
    }));
    const buffer = await result.arrayBuffer();
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(new Blob([buffer])), formats: ALL_FORMATS });
    try { return { buffer, duration: await input.computeDuration() }; }
    finally { input.dispose(); }
  }
}
