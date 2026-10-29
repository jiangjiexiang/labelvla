import React, { useMemo } from 'react';
import { Button } from '@/ui';
import {
  PanelLeftClose,
  PanelRightClose,
  PanelBottomClose,
  PanelBottomOpen,
  Loader2,
  Home,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { Separator } from '@/ui';
import { ExportButton } from './ExportButton';
import { cn } from '@/ui';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui';
import { useLoading } from '../contexts/LoadingContext';
import type { HistoryItem } from '../hooks/useOpenHistory';
import type { ValidationReport } from '@/core';

interface NavbarProps {
  onOpenDirectory?: () => void;
  onOpenLocalArchive?: () => void;
  onOpenRemoteArchive?: (url?: string) => void;
  onOpenSample?: () => void;
  onOpenUrl?: (url: string) => void;
  onRestoreHistory?: (item: HistoryItem) => void;
  onGoHome?: () => void;
  onExport?: () => void;
  history?: HistoryItem[];
  datasetName?: string;
  sidebarVisible?: boolean;
  playbackBarVisible?: boolean;
  onToggleSidebar?: () => void;
  onTogglePlaybackBar?: () => void;
  validationReport?: ValidationReport | null;
  onOpenHealth?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onGoHome,
  onExport,
  datasetName,
  sidebarVisible = true,
  playbackBarVisible = true,
  onToggleSidebar,
  onTogglePlaybackBar,
  validationReport = null,
  onOpenHealth,
}) => {
  const { t } = useTranslation();
  const { tasks } = useLoading();

  const activeTask = useMemo(() => {
    // Only show "truly running" tasks
    const running = tasks.find(
      (tk) => tk.phase !== 'ready' && tk.phase !== 'error' && tk.phase !== 'idle',
    );
    const errored = tasks.find((tk) => tk.phase === 'error');
    return running || errored || undefined;
  }, [tasks]);

  const percent = useMemo(() => {
    if (!activeTask || !activeTask.total || activeTask.total <= 0) return undefined;
    if ((activeTask.loaded || 0) <= 0) return undefined;
    return Math.min(100, Math.round(((activeTask.loaded || 0) / activeTask.total) * 100));
  }, [activeTask]);

  const isLoading = useMemo(() => {
    return activeTask && activeTask.phase !== 'error' && !percent;
  }, [activeTask, percent]);

  const displayName = datasetName || 'LabelVLA 数据平台';

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background text-foreground">
      <div className="relative grid h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4 sm:px-4">
        {/* Left: Open & History */}
        <div className="flex min-w-0 items-center gap-2 justify-self-start">
          {datasetName && onGoHome && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    onClick={onGoHome}
                  />
                }
              >
                <Home className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('navbar.goHome')}</TooltipContent>
            </Tooltip>
          )}

          {onExport && <ExportButton onClick={onExport} />}

          {(datasetName || validationReport) && onOpenHealth && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-8 gap-2 text-xs font-medium',
                      validationReport?.hasError && 'text-destructive hover:text-destructive',
                      !validationReport?.hasError &&
                        validationReport?.hasWarning &&
                        'text-amber-600 dark:text-amber-500 hover:text-amber-600',
                      !validationReport?.hasError &&
                        !validationReport?.hasWarning &&
                        'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={onOpenHealth}
                  />
                }
              >
                {validationReport?.hasError ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : validationReport?.hasWarning ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
                )}
                <span className="hidden sm:inline">{t('health.check', 'Check')}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('health.healthCheckButton', 'Dataset health check')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Center: Title */}
        <div
          className="flex min-w-0 items-center justify-center gap-2 sm:max-w-[40vw]"
          role={isLoading ? 'status' : undefined}
          aria-live={isLoading ? 'polite' : undefined}
        >
          {isLoading ? (
            <Loader2
              className="h-4 w-4 text-primary animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : null}
          <span
            data-testid="lerobot-navbar-title"
            className={`block min-w-0 truncate text-sm font-semibold tracking-tight ${isLoading ? 'text-muted-foreground animate-pulse' : ''}`}
            title={displayName}
          >
            {displayName}
          </span>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-1 justify-self-end">
          {/* View Controls */}
          {(onToggleSidebar || onTogglePlaybackBar) && (
            <>
              <div className="flex items-center gap-0.5 sm:mr-2">
                {onToggleSidebar && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={onToggleSidebar}
                        />
                      }
                    >
                      {sidebarVisible ? (
                        <PanelLeftClose className="h-4 w-4" />
                      ) : (
                        <PanelRightClose className="h-4 w-4" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {sidebarVisible ? t('navbar.hideSidebar') : t('navbar.showSidebar')}
                    </TooltipContent>
                  </Tooltip>
                )}

                {onTogglePlaybackBar && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hidden h-8 w-8 text-muted-foreground hover:text-foreground sm:inline-flex"
                          onClick={onTogglePlaybackBar}
                        />
                      }
                    >
                      {playbackBarVisible ? (
                        <PanelBottomClose className="h-4 w-4" />
                      ) : (
                        <PanelBottomOpen className="h-4 w-4" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {playbackBarVisible
                        ? t('navbar.hidePlaybackBar')
                        : t('navbar.showPlaybackBar')}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <Separator orientation="vertical" className="mr-2 hidden h-4 sm:block" />
            </>
          )}

          {/* Theme & Language */}
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Bottom Progress Bar */}
      {(activeTask || percent !== undefined) && (
        <div
          className="absolute bottom-0 left-0 w-full h-[2px] bg-muted overflow-hidden"
          role="progressbar"
          aria-label={activeTask?.message || t('common.loading')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          {activeTask && activeTask.phase === 'error' ? (
            <div className="h-full w-full bg-destructive" />
          ) : percent !== undefined ? (
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-primary animate-indeterminate-loading" />
          )}
        </div>
      )}
    </nav>
  );
};
