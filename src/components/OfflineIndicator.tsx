import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, CheckCircle2, HardDrive } from 'lucide-react';

interface OfflineIndicatorProps {
  isOnline: boolean;
  wasOffline: boolean;
  onClearWasOffline: () => void;
  pendingSyncCount?: number;
  isSyncing?: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  isOnline,
  wasOffline,
  onClearWasOffline,
  pendingSyncCount = 0,
  isSyncing = false,
}) => {
  const [reconnectBannerVisible, setReconnectBannerVisible] = useState(false);

  useEffect(() => {
    if (wasOffline && isOnline) {
      setReconnectBannerVisible(true);
      const timer = setTimeout(() => {
        setReconnectBannerVisible(false);
        onClearWasOffline();
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [wasOffline, isOnline, onClearWasOffline]);

  // Offline banner (Persistent while offline)
  if (!isOnline) {
    return (
      <aside
        id="offline_status_indicator"
        aria-label="Offline status"
        className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-auto sm:max-w-md z-40 animate-in slide-in-from-bottom duration-300 pointer-events-auto"
      >
        <div className="p-3.5 bg-[#0E1E2B] border border-amber-500/40 rounded-xl shadow-xl flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
              <WifiOff className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-amber-400">
                  Offline Mode
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              </div>
              <p className="text-xs text-slate-300 leading-tight truncate">
                Full offline access. Data saved locally.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 bg-white/5 px-2 py-1 rounded-md border border-white/10 text-[10px] font-mono text-slate-300">
            <HardDrive className="w-3 h-3 text-[#B2E5F6]" />
            <span>Local</span>
          </div>
        </div>
      </aside>
    );
  }

  // Reconnected banner (Auto-dismissing)
  if (reconnectBannerVisible) {
    return (
      <aside
        id="reconnected_status_indicator"
        aria-label="Reconnected status"
        className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-auto sm:max-w-md z-40 animate-in slide-in-from-bottom duration-300 pointer-events-auto"
      >
        <div className="p-3.5 bg-[#0E1E2B] border border-[#628EF7]/50 rounded-xl shadow-xl flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#628EF7]/20 border border-[#628EF7]/40 flex items-center justify-center shrink-0">
              {isSyncing ? (
                <RefreshCw className="w-4 h-4 text-[#8DE9F6] animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-[#8DE9F6]">
                  Back Online
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-tight">
                {isSyncing ? 'Synchronizing pending records…' : 'Connection restored & synchronized.'}
              </p>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return null;
};

/**
 * Compact Pill Badge for displaying Sync and Network status in Header or Profile
 */
export const ConnectivitySyncBadge: React.FC<{
  isOnline: boolean;
  pendingCount: number;
  isSyncing?: boolean;
}> = ({ isOnline, pendingCount, isSyncing = false }) => {
  if (!isOnline) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-900 text-[10px] sm:text-[11px] font-mono uppercase tracking-wider font-semibold select-none"
        title="Working offline. Changes are saved locally on this device."
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        <span>Offline</span>
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#628EF7]/10 border border-[#628EF7]/30 text-[#0E1E2B] text-[10px] sm:text-[11px] font-mono uppercase tracking-wider font-semibold select-none">
        <RefreshCw className="w-3 h-3 text-[#628EF7] animate-spin" />
        <span>Syncing…</span>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0E1E2B]/10 border border-[#0E1E2B]/20 text-[#0E1E2B] text-[10px] sm:text-[11px] font-mono uppercase tracking-wider font-semibold select-none"
        title={`${pendingCount} change${pendingCount === 1 ? '' : 's'} queued for cloud sync.`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#628EF7] animate-pulse" />
        <span>Saved</span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 text-[10px] sm:text-[11px] font-mono uppercase tracking-wider font-semibold select-none"
      title="All changes saved to device and synchronized with cloud."
    >
      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
      <span>Synced</span>
    </div>
  );
};
