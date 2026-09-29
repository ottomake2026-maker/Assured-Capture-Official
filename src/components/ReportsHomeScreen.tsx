import React, { useState, useMemo } from 'react';
import { Report, UserProfile } from '../types';
import { StatusBadge } from './StatusBadge';
import { AssuredLogo } from './AssuredLogo';
import { Search, Calendar, MapPin, Building, FileText, Download, Check, AlertCircle, User as UserIcon, Plus } from 'lucide-react';
import { exportPhotoReportDocx } from '../utils/docxExport';
import { exportPhotoReportPdf } from '../utils/pdfExport';
import { ExportFormatDialog } from './ExportFormatDialog';
import { ConnectivitySyncBadge } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';

interface ReportsHomeScreenProps {
  reports: Report[];
  userProfile?: UserProfile;
  onOpenReport: (reportId: string) => void;
  onCreateNewReport: () => void;
  onOpenProfile?: () => void;
  isLoading?: boolean;
  isGuest?: boolean;
  onSignInRequest?: () => void;
  syncStatus?: { text: string; type: 'loading' | 'success' | 'error' } | null;
  isOnline?: boolean;
  pendingSyncCount?: number;
  isSyncing?: boolean;
}

export const ReportsHomeScreen: React.FC<ReportsHomeScreenProps> = ({
  reports,
  userProfile,
  onOpenReport,
  onCreateNewReport,
  onOpenProfile,
  isLoading = false,
  isGuest = false,
  onSignInRequest,
  syncStatus = null,
  isOnline = true,
  pendingSyncCount = 0,
  isSyncing = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [exportingReportId, setExportingReportId] = useState<string | null>(null);
  const [selectedReportForExport, setSelectedReportForExport] = useState<Report | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Trigger export format dialog for a report
  const handleOpenExportDialog = (e: React.MouseEvent, report: Report) => {
    e.stopPropagation();
    if (exportingReportId) return;
    setSelectedReportForExport(report);
  };

  // Handle format export from dialog
  const handleSelectExportFormat = async (format: 'pdf' | 'docx') => {
    if (!selectedReportForExport) return;
    const report = selectedReportForExport;
    setExportingReportId(report.id);
    setExportingFormat(format);
    setExportFeedback(null);
    setSelectedReportForExport(null);

    try {
      if (format === 'pdf') {
        await exportPhotoReportPdf(report);
        setExportFeedback({
          type: 'success',
          text: `PDF photo report successfully generated for ${report.jobReference || 'report'}`,
        });
      } else {
        await exportPhotoReportDocx(report);
        setExportFeedback({
          type: 'success',
          text: `DOCX photo report successfully generated for ${report.jobReference || 'report'}`,
        });
      }
      setTimeout(() => setExportFeedback(null), 4000);
    } catch (err: any) {
      console.error('Export error:', err);
      setExportFeedback({
        type: 'error',
        text: err?.message || `Failed to export ${format.toUpperCase()} photo report. Please try again.`,
      });
      setTimeout(() => setExportFeedback(null), 5000);
    } finally {
      setExportingReportId(null);
      setExportingFormat(null);
    }
  };

  // Filter search against Job Reference, Report Name, Client Name
  const filteredReports = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return reports;

    return reports.filter(r => {
      const matchJob = (r.jobReference || '').toLowerCase().includes(term);
      const matchName = (r.reportName || '').toLowerCase().includes(term);
      const matchClient = (r.clientName || '').toLowerCase().includes(term);
      return matchJob || matchName || matchClient;
    });
  }, [reports, searchTerm]);

  return (
    <div className="w-full">
      {/* 2 & 3. Brand Header: Compact architectural panel with pale cyan surface & strong left alignment */}
      <header className="w-full bg-[#B2E5F6] border-b border-[#0E1E2B]/15 px-4 py-4 sm:px-6 sm:py-5">
        <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="min-w-0">
            {/* ASSURED CAPTURE: Official wordmark remains visually dominant, CAPTURE is a smaller product descriptor */}
            <div className="flex items-baseline gap-2 sm:gap-2.5 flex-wrap">
              <AssuredLogo className="h-6 sm:h-7" />
              <span className="font-sans font-extrabold tracking-[0.18em] text-[11px] sm:text-xs text-[#628EF7] uppercase select-none">
                CAPTURE
              </span>
            </div>
            {/* Supporting description below: Field inspection & photographic evidence system */}
            <p className="text-[10px] sm:text-[11px] font-mono tracking-wider uppercase text-[#0E1E2B]/60 mt-1.5 leading-tight">
              FIELD INSPECTION &amp; PHOTOGRAPHIC EVIDENCE SYSTEM
            </p>
          </div>

          {/* Right Header Controls: Sync Badge + PWA Install + User Profile */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ConnectivitySyncBadge
              isOnline={isOnline}
              pendingCount={pendingSyncCount}
              isSyncing={isSyncing}
            />

            <PWAInstallButton variant="header" />

            {/* User / Profile control on the right */}
            {onOpenProfile && (
              <button
                type="button"
                id="btn_open_profile"
                onClick={onOpenProfile}
                className="relative p-0.5 rounded-full ring-1 ring-[#0E1E2B]/20 hover:ring-[#0E1E2B] active:scale-95 transition-all shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#628EF7]/40 min-w-[44px] min-h-[44px] flex items-center justify-center"
                title={isGuest ? 'Guest Mode · Settings' : `View Profile: ${userProfile?.displayName || userProfile?.profileName || userProfile?.name || 'User Profile'}`}
                aria-label={isGuest ? 'Guest Mode Settings' : 'Open User Profile'}
              >
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden bg-white border border-[#0E1E2B]/10 flex items-center justify-center">
                  {!isGuest && userProfile?.avatarUrl ? (
                    <img
                      src={userProfile.avatarUrl}
                      alt={userProfile?.displayName || userProfile?.profileName || userProfile?.name || 'User Profile'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <UserIcon className="w-5 h-5 text-[#0E1E2B]/60" />
                  )}
                </div>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Working Surface */}
      <div className="w-full max-w-3xl lg:max-w-4xl mx-auto px-4 py-5 sm:px-6 sm:py-8 space-y-6">
        {/* Guest Mode Notice */}
        {isGuest && (
          <div
            id="guest_mode_notice_banner"
            className="p-3.5 bg-white border border-[#0E1E2B]/15 rounded-xl text-xs text-[#0E1E2B] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 shadow-2xs"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#E06A55] shrink-0" />
              <span className="leading-snug">
                <strong className="font-bold text-[#0E1E2B]">Guest Mode:</strong> Reports are stored only on this device and may not be recoverable if device data is cleared.
              </span>
            </div>
            {onSignInRequest && (
              <button
                type="button"
                id="btn_guest_banner_signin"
                onClick={onSignInRequest}
                className="font-bold text-[#628EF7] hover:text-[#4E7AF2] underline underline-offset-2 shrink-0 cursor-pointer"
              >
                Sign in to link account
              </button>
            )}
          </div>
        )}

        {/* 1. Level 3: Primary Action - Single plus icon with NEW REPORT in Electric Blue */}
        <div>
          <button
            type="button"
            onClick={onCreateNewReport}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-sm tracking-wider uppercase rounded-lg transition-colors touch-manipulation h-[48px] sm:h-[52px] active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-[#628EF7]/25 cursor-pointer shadow-sm"
            aria-label="Create new report"
          >
            <Plus className="w-4.5 h-4.5 stroke-[2.5]" />
            <span>NEW REPORT</span>
          </button>
        </div>

        {/* Export Notification Feedback */}
        {exportFeedback && (
          <div
            className={`p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 border ${
              exportFeedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-950 border-emerald-200'
                : 'bg-rose-50 text-rose-950 border-rose-200'
            }`}
          >
            {exportFeedback.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-600 shrink-0 stroke-[2.5]" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 stroke-[2.5]" />
            )}
            <span>{exportFeedback.text}</span>
          </div>
        )}

        {/* Synchronization state indicator */}
        {syncStatus && (!isLoading || syncStatus.type !== 'loading') && (
          <div
            id="reports_sync_status_banner"
            className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2.5 border transition-all ${
              syncStatus.type === 'loading'
                ? 'bg-[#B2E5F6]/25 text-[#0E1E2B] border-[#0E1E2B]/15'
                : syncStatus.type === 'success'
                ? 'bg-emerald-50 text-emerald-950 border-emerald-200'
                : 'bg-rose-50 text-rose-950 border-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {syncStatus.type === 'loading' ? (
                <span className="w-3.5 h-3.5 border-2 border-[#0E1E2B]/30 border-t-[#628EF7] rounded-full animate-spin shrink-0" />
              ) : syncStatus.type === 'success' ? (
                <Check className="w-4 h-4 text-emerald-600 shrink-0 stroke-[2.5]" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 stroke-[2.5]" />
              )}
              <span>{syncStatus.text}</span>
            </div>
          </div>
        )}

        {/* 5. Search: directly below New Report, quieter, white bg, subtle border, placeholder */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#0E1E2B]/40">
            <Search className="w-4.5 h-4.5 stroke-[2]" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search reports by reference, name..."
            className="w-full pl-11 pr-14 py-3 bg-white border border-[#0E1E2B]/15 rounded-lg text-sm sm:text-base text-[#0E1E2B] placeholder:text-[#0E1E2B]/40 font-normal focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[48px]"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-4 flex items-center text-xs font-semibold text-[#0E1E2B]/50 hover:text-[#0E1E2B] cursor-pointer min-h-[44px] touch-manipulation"
            >
              Clear
            </button>
          )}
        </div>

        {/* Loading state: subtle skeleton placeholders using existing Reports layout */}
        {isLoading ? (
          <div id="reports_skeleton_container" className="space-y-3" aria-busy="true" aria-label="Loading reports">
            <div className="flex items-baseline justify-between px-0.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0E1E2B]/75">
                <span className="w-3.5 h-3.5 border-2 border-[#0E1E2B]/30 border-t-[#628EF7] rounded-full animate-spin shrink-0" />
                <span>Loading your reports…</span>
              </div>
              <div className="h-3 w-28 bg-[#0E1E2B]/5 rounded animate-pulse" />
            </div>

            {/* Skeleton Inspection Register using existing card structure */}
            <div className="bg-white rounded-xl border border-[#0E1E2B]/15 divide-y divide-[#0E1E2B]/10 overflow-hidden shadow-2xs">
              {[1, 2, 3].map((item) => (
                <div key={item} className="w-full p-4 sm:p-5 text-left block">
                  <div className="space-y-3">
                    {/* Title + Thumbnail row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-2">
                        {/* Title skeleton */}
                        <div
                          className="h-5 bg-[#0E1E2B]/10 rounded animate-pulse"
                          style={{ width: item === 1 ? '58%' : item === 2 ? '72%' : '48%' }}
                        />
                        {/* Reference badge + Status badge skeleton */}
                        <div className="flex items-center gap-2 pt-0.5">
                          <div className="h-5 w-20 bg-[#B2E5F6]/40 rounded border border-[#0E1E2B]/10 animate-pulse" />
                          <div className="h-5 w-24 bg-[#0E1E2B]/5 rounded border border-[#0E1E2B]/10 animate-pulse" />
                        </div>
                      </div>

                      {/* Thumbnail skeleton */}
                      <div className="shrink-0 w-16 h-12 sm:w-20 sm:h-14 rounded-lg border border-[#0E1E2B]/15 bg-[#0E1E2B]/5 animate-pulse" />
                    </div>

                    {/* Site / Client metadata skeleton */}
                    <div className="space-y-1.5 pt-0.5">
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded bg-[#0E1E2B]/10 shrink-0" />
                        <div
                          className="h-3.5 bg-[#0E1E2B]/8 rounded animate-pulse"
                          style={{ width: item === 1 ? '38%' : '30%' }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded bg-[#0E1E2B]/10 shrink-0" />
                        <div
                          className="h-3.5 bg-[#0E1E2B]/6 rounded animate-pulse"
                          style={{ width: item === 1 ? '52%' : '42%' }}
                        />
                      </div>
                    </div>

                    {/* Inspection date + Export button row skeleton */}
                    <div className="pt-2.5 flex items-center justify-between gap-3 border-t border-[#0E1E2B]/10">
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded bg-[#0E1E2B]/10 shrink-0" />
                        <div className="h-3.5 w-32 bg-[#0E1E2B]/8 rounded animate-pulse" />
                      </div>
                      <div className="h-8 w-20 rounded-lg bg-[#0E1E2B]/5 border border-[#0E1E2B]/15 animate-pulse shrink-0" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : filteredReports.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-xl border border-[#0E1E2B]/15 p-8 sm:p-12 text-center shadow-2xs">
            <div className="w-12 h-12 rounded-xl bg-[#B2E5F6]/40 text-[#0E1E2B] flex items-center justify-center mx-auto mb-3 border border-[#B2E5F6]">
              <FileText className="w-6 h-6 stroke-[1.8]" />
            </div>
            <h2 className="text-base sm:text-lg font-sans font-bold text-[#0E1E2B] mb-1.5 tracking-tight">
              {searchTerm ? 'No matching reports' : 'No reports yet'}
            </h2>
            <p className="text-xs text-[#0E1E2B]/65 mb-5 max-w-sm mx-auto font-normal">
              {searchTerm
                ? `No reports matched "${searchTerm}". Check the Job Reference or Report Name.`
                : 'Create your first field inspection photo report to get started.'}
            </p>
            <button
              type="button"
              onClick={onCreateNewReport}
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs tracking-wider uppercase rounded-lg min-h-[48px] touch-manipulation active:scale-[0.98] cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>NEW REPORT</span>
            </button>
          </div>
        ) : (
          /* 6. RECENT INSPECTIONS Header with count */
          <div className="space-y-3">
            <div className="flex items-baseline justify-between px-0.5">
              <h2 className="text-xs sm:text-sm font-sans font-bold uppercase tracking-wider text-[#0E1E2B]">
                RECENT INSPECTIONS ({filteredReports.length})
              </h2>
            </div>

            {/* 4 & 7 & 13. Professional Inspection Register: Clean register surface with quiet line dividers */}
            <div className="bg-white rounded-xl border border-[#0E1E2B]/15 divide-y divide-[#0E1E2B]/10 overflow-hidden shadow-2xs">
              {filteredReports.map(report => (
                <div
                  key={report.id}
                  onClick={() => onOpenReport(report.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onOpenReport(report.id);
                    }
                  }}
                  className="group relative w-full p-4 sm:p-5 hover:bg-[#F4F6F8]/60 transition-colors cursor-pointer touch-manipulation text-left block focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#628EF7]"
                >
                  <div className="space-y-3">
                    {/* 5. REPORT TITLE (strongest) + REPORT THUMBNAIL (rectangular evidence) */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* 1. REPORT TITLE */}
                        <h3 className="text-base sm:text-lg font-sans font-bold text-[#0E1E2B] group-hover:text-[#4E7AF2] transition-colors leading-snug tracking-tight">
                          {report.reportName ? report.reportName : <span className="text-[#0E1E2B]/40 font-normal">(Untitled Report)</span>}
                        </h3>

                        {/* 2 & 3. REPORT REFERENCE + STATUS (tightly related metadata group) */}
                        <div className="flex items-center gap-2 pt-0.5">
                          <span className="font-mono font-bold text-[11px] sm:text-xs tracking-wide uppercase text-[#0E1E2B] bg-[#B2E5F6]/40 px-2 py-0.5 rounded border border-[#0E1E2B]/15 inline-block">
                            {report.jobReference || 'BBC26-??'}
                          </span>
                          <StatusBadge status={report.status} size="sm" />
                        </div>
                      </div>

                      {/* 8. Inspection Thumbnail: Restrained rectangular evidence crop */}
                      {report.reportImage && (
                        <div className="shrink-0 w-16 h-12 sm:w-20 sm:h-14 rounded-lg overflow-hidden border border-[#0E1E2B]/15 bg-[#0E1E2B]/5">
                          <img
                            src={report.reportImage}
                            alt="Inspection evidence thumbnail"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        </div>
                      )}
                    </div>

                    {/* 4 & 5. SITE / CLIENT & LOCATION (tightly related metadata group) */}
                    {(report.clientName || report.address) && (
                      <div className="space-y-1 text-xs text-[#0E1E2B]/75 pt-0.5">
                        {report.clientName && (
                          <div className="flex items-center gap-1.5 font-medium text-[#0E1E2B]">
                            <Building className="w-3.5 h-3.5 text-[#0E1E2B]/50 shrink-0 stroke-[2]" />
                            <span className="truncate">{report.clientName}</span>
                          </div>
                        )}
                        {report.address && (
                          <div className="flex items-center gap-1.5 text-[#0E1E2B]/60 text-xs">
                            <MapPin className="w-3.5 h-3.5 text-[#0E1E2B]/40 shrink-0 stroke-[2]" />
                            <span className="truncate">{report.address}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 6 & 7. INSPECTION DATE + EXPORT (tightly related footer group) */}
                    <div className="pt-2.5 flex items-center justify-between gap-3 text-xs text-[#0E1E2B]/65 border-t border-[#0E1E2B]/10">
                      <div className="flex items-center gap-1.5 font-medium text-xs">
                        <Calendar className="w-3.5 h-3.5 text-[#0E1E2B]/50 shrink-0 stroke-[2]" />
                        <span>Inspection: <strong className="text-[#0E1E2B] font-mono text-xs ml-1 font-semibold">{report.inspectionDate || 'Not set'}</strong></span>
                      </div>

                      {/* 7. Restrained outlined export button, comfortable 44-48px touch target */}
                      <button
                        type="button"
                        onClick={(e) => handleOpenExportDialog(e, report)}
                        disabled={exportingReportId === report.id}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-[#F4F6F8] active:bg-[#E9ECF0] text-[#0E1E2B] border border-[#0E1E2B]/20 hover:border-[#0E1E2B] font-sans font-bold text-xs tracking-wider transition-colors touch-manipulation focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30 shrink-0 cursor-pointer min-h-[44px]"
                        title="Export Photo Report (PDF or DOCX)"
                        aria-label={`Export photo report for ${report.jobReference || 'report'}`}
                      >
                        {exportingReportId === report.id ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-[#0E1E2B]/30 border-t-[#628EF7] rounded-full animate-spin shrink-0" />
                            <span>Exporting {exportingFormat?.toUpperCase() || ''}...</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5 stroke-[2.2]" />
                            <span>EXPORT</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Format Selection Dialog for Report Card Export */}
      <ExportFormatDialog
        isOpen={Boolean(selectedReportForExport)}
        onClose={() => setSelectedReportForExport(null)}
        onSelectFormat={handleSelectExportFormat}
        isExporting={Boolean(exportingReportId)}
        exportingFormat={exportingFormat}
      />
    </div>
  );
};
