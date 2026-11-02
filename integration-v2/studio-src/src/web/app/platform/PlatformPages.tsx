import { Dashboard } from '../Dashboard';
import { DatasetList } from '../DatasetList';
import { QcReport } from '../QcReport';
import { Users } from '../Users';
import { EpisodesPage, TaskCreatePage, TaskDetailPage, TasksPage, VersionsPage, VideosPage } from './GeneralPages';
import { PlatformNav } from './PlatformNav';
import { getStudioReturnPage, usePage } from './usePage';
import './platform-general.css';

export function PlatformPages() {
  const [page, setPage] = usePage();
  if (!page) {
    return <button className="g-return-platform" onClick={() => setPage(getStudioReturnPage())}>← 返回数据平台</button>;
  }
  return (
    <div className="g-platform">
      <PlatformNav />
      <main className="g-main">
        {page === 'dashboard' && <Dashboard />}
        {page === 'datasets' && <DatasetList />}
        {page === 'episodes' && <EpisodesPage />}
        {page === 'tasks' && <TasksPage />}
        {page === 'task-create' && <TaskCreatePage />}
        {page === 'task-detail' && <TaskDetailPage />}
        {page === 'videos' && <VideosPage />}
        {page === 'versions' && <VersionsPage />}
        {page === 'users' && <Users />}
        {page === 'qc' && <QcReport />}
      </main>
    </div>
  );
}
