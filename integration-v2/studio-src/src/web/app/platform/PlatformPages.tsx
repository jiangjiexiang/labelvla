/** 平台页容器:按 ?page= 切换,作为覆盖层叠在标注工作区之上。 */
import { Dashboard } from '../Dashboard';
import { DatasetList } from '../DatasetList';
import { QcReport } from '../QcReport';
import { Users } from '../Users';
import { PlatformNav } from './PlatformNav';
import { usePage } from './usePage';

export function PlatformPages() {
  const [page, setPage] = usePage();
  if (!page) {
    return (
      <button
        className="fixed bottom-14 right-4 z-40 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-md hover:text-foreground"
        onClick={() => setPage('datasets')}
      >
        数据平台 →
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <PlatformNav />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {page === 'dashboard' && <Dashboard />}
        {page === 'datasets' && <DatasetList />}
        {page === 'users' && <Users />}
        {page === 'qc' && <QcReport />}
      </div>
    </div>
  );
}
