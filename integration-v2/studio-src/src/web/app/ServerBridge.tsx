import { useEffect, useState } from 'react';
import { useLeRobotData } from '../../react/contexts/LeRobotContext';
import { useAnnotation } from '../annotation/AnnotationContext';
import { connectServerDataset } from './serverDataset';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  cn,
} from '@/ui';
import { ChevronUp, Database, Folder, Loader2 } from 'lucide-react';

type DirectoryEntry = { name: string; path: string; is_dataset: boolean };
type DirectoryListing = {
  path: string;
  parent: string | null;
  is_dataset: boolean;
  entries: DirectoryEntry[];
};

async function fetchDatasetVersion(path: string): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/bridge/file?dataset=${encodeURIComponent(path)}&path=${encodeURIComponent('meta/info.json')}`,
    );
    if (!response.ok) return null;
    const info = (await response.json()) as { codebase_version?: unknown };
    const version = info.codebase_version;
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null;
  }
}

function VersionBadge({ version }: { version?: string | null }) {
  if (!version) return null;
  return (
    <Badge variant="secondary" className="font-mono text-[11px]">
      {version}
    </Badge>
  );
}

export function ServerBridge({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened: (name: string) => void;
}) {
  const { initialize } = useLeRobotData();
  const a = useAnnotation();
  const [directory, setDirectory] = useState('/data');
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const reset = (e: Event) => {
      if (a?.dirty) {
        e.preventDefault();
        setMessage('请先保存标注再切换数据集');
      } else a?.setDataset('');
    };
    window.addEventListener('studio-external-source', reset);
    return () => window.removeEventListener('studio-external-source', reset);
  }, [a]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setListing(null);
    setMessage('正在读取目录…');
    fetch(`/api/fs?path=${encodeURIComponent(directory)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).detail || '无法读取目录');
        return r.json() as Promise<DirectoryListing>;
      })
      .then((data) => {
        if (!cancelled) {
          setListing(data);
          setMessage('');
        }
      })
      .catch((e) => {
        if (!cancelled) setMessage(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, directory]);

  // Read each dataset's codebase_version from meta/info.json so the picker can
  // show whether a folder is a v2.x or v3.x dataset.
  useEffect(() => {
    if (!open || !listing) return;
    let cancelled = false;
    const datasets = listing.entries.filter((entry) => entry.is_dataset);
    void Promise.all(
      datasets.map(async (entry) => [entry.path, await fetchDatasetVersion(entry.path)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      const resolved: Record<string, string> = {};
      for (const [path, version] of pairs) if (version) resolved[path] = version;
      setVersions((prev) => ({ ...prev, ...resolved }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, listing]);

  useEffect(() => {
    if (!open || !listing?.is_dataset) return;
    let cancelled = false;
    void fetchDatasetVersion(listing.path).then((version) => {
      if (!cancelled && version) setVersions((prev) => ({ ...prev, [listing.path]: version }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, listing]);

  const openDataset = async (path: string) => {
    if (a?.dirty) {
      setMessage('请先保存当前标注，再切换数据集。');
      return;
    }
    setBusy(true);
    setMessage('正在读取数据集…');
    try {
      const { name } = await connectServerDataset(path, initialize, a?.setDataset);
      onOpened(name);
      onClose();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="flex h-[min(80vh,640px)] w-[min(640px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="flex-row items-center gap-2 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-base font-semibold">选择服务器数据集</DialogTitle>
          <DialogDescription className="sr-only">
            浏览服务器数据目录并打开 LeRobot 数据集
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <Button
            variant="outline"
            size="sm"
            disabled={!listing?.parent || busy}
            onClick={() => listing?.parent && setDirectory(listing.parent)}
          >
            <ChevronUp />
            上一级
          </Button>
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
            title={listing?.path || directory}
          >
            {listing?.path || directory}
          </span>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {listing?.entries.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                此目录下没有文件夹
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {listing?.entries.map((entry) => (
                <li
                  key={entry.path}
                  className={cn(
                    'group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                    'hover:bg-accent',
                  )}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDirectory(entry.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                    title={entry.name}
                  >
                    {entry.is_dataset ? (
                      <Database className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{entry.name}</span>
                    {entry.is_dataset && <VersionBadge version={versions[entry.path]} />}
                  </button>
                  {entry.is_dataset && (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() => void openDataset(entry.path)}
                    >
                      打开
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>

        {message && (
          <div
            role="status"
            className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground"
          >
            {busy && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />}
            {message}
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border px-4 py-3 sm:justify-end">
          {listing?.is_dataset && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => listing && void openDataset(listing.path)}
            >
              打开当前数据集
              <VersionBadge version={versions[listing.path]} />
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
