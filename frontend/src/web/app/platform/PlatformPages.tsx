import { useState } from 'react';
import { PortalContainerProvider } from '../../../ui/portal-container';
import { Dashboard } from '../Dashboard';
import { DatasetList } from '../DatasetList';
import { QcReport } from '../QcReport';
import { Users } from '../Users';
import { EpisodesPage, TaskCreatePage, TaskDetailPage, TasksPage, VersionsPage, VideosPage } from './GeneralPages';
import { PlatformNav } from './PlatformNav';
import { usePage } from './usePage';
import './platform-general.css';

export function PlatformPages() {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [page] = usePage();
  if (!page) {
    return null;
  }
  return (
    <div className="g-platform" ref={setPortalContainer}>
      <PortalContainerProvider container={portalContainer}>
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
      </PortalContainerProvider>
    </div>
  );
}
