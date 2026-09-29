import React, { useState, useEffect, useRef } from 'react';
import { Report, Issue, ReportStatus } from '../types';
import { ALL_REPORT_STATUSES, StatusBadge } from './StatusBadge';
import { ConfirmationDialog } from './ConfirmationDialog';
import { InspectionHistoryModal } from './InspectionHistoryModal';
import { AssuredLogo } from './AssuredLogo';
import { exportPhotoReportDocx } from '../utils/docxExport';
import { exportPhotoReportPdf } from '../utils/pdfExport';
import { ExportFormatDialog } from './ExportFormatDialog';
import { getTwoDigitYear } from '../db/storage';
import {
  ArrowLeft,
  Save,
  Trash2,
  History,
  Check,
  AlertCircle,
  Camera,
  ChevronRight,
  MapPin,
  Image as ImageIcon,
  ImagePlus,
  Upload,
  FileDown,
} from 'lucide-react';

interface ReportDetailScreenProps {
  report: Report;
  issues: Issue[];
  photoCounts: Record<string, number>;
  onBack: () => void;
  onSaveReport: (updatedReport: Report) => Promise<boolean>;
  onOpenIssuesList: () => void;
  onAddIssue?: () => void;
  onOpenIssue?: (issueId: string) => void;
  onDeleteReport: (reportId: string) => Promise<boolean>;
  isNewReport?: boolean;
}

/**
 * Parse job reference into prefix (e.g. BBC26-) and remaining number (e.g. 123)
 * For new reports, prefix is BBCYY- where YY is current calendar year.
 * For existing saved reports, existing prefix & reference are strictly preserved even across year changes.
 */
function parseJobReference(rawRef: string, isNew: boolean): { prefix: string; number: string } {
  const currentYY = getTwoDigitYear();
  const defaultPrefix = `BBC${currentYY}-`;

  if (isNew) {
    if (rawRef && rawRef.startsWith(defaultPrefix)) {
      return { prefix: defaultPrefix, number: rawRef.slice(defaultPrefix.length) };
    }
    return { prefix: defaultPrefix, number: '' };
  }

  // Existing saved report:
  if (!rawRef) {
    return { prefix: defaultPrefix, number: '' };
  }

  // 1. Check for standard BBCYY- (e.g. BBC26-, BBC25-)
  const bbcMatch = rawRef.match(/^(BBC\d{2}-)/i);
  if (bbcMatch) {
    return {
      prefix: bbcMatch[1].toUpperCase(),
      number: rawRef.slice(bbcMatch[1].length),
    };
  }

  // 2. Check for legacy BBC-YY- (e.g. BBC-26-)
  const legacyMatch = rawRef.match(/^(BBC-\d{2}-)/i);
  if (legacyMatch) {
    return {
      prefix: legacyMatch[1].toUpperCase(),
      number: rawRef.slice(legacyMatch[1].length),
    };
  }

  // 3. Check for any generic alpha prefix with a single trailing hyphen (e.g. JOB-)
  const genericMatch = rawRef.match(/^([A-Za-z]+-)/);
  if (genericMatch) {
    return {
      prefix: genericMatch[1],
      number: rawRef.slice(genericMatch[1].length),
    };
  }

  return {
    prefix: '',
    number: rawRef,
  };
}

export const ReportDetailScreen: React.FC<ReportDetailScreenProps> = ({
  report,
  issues,
  photoCounts,
  onBack,
  onSaveReport,
  onOpenIssuesList,
  onAddIssue,
  onOpenIssue,
  onDeleteReport,
  isNewReport = false,
}) => {
  // Local editable form fields with protected prefix
  const initialRefData = parseJobReference(report.jobReference || '', isNewReport);
  const [jobPrefix, setJobPrefix] = useState(initialRefData.prefix);
  const [jobNumber, setJobNumber] = useState(initialRefData.number);
  const [jobReference, setJobReference] = useState(
    report.jobReference || (initialRefData.prefix + initialRefData.number)
  );
  const [reportName, setReportName] = useState(report.reportName || '');
  const [clientName, setClientName] = useState(report.clientName || '');
  const [address, setAddress] = useState(report.address || '');
  const [reportDate, setReportDate] = useState(report.reportDate || '');
  const [status, setStatus] = useState<ReportStatus>(report.status || 'Draft');
  const [inspectionDate, setInspectionDate] = useState(report.inspectionDate || '');
  const [reportImage, setReportImage] = useState<string>(report.reportImage || '');

  // Image upload and capture states
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Track if this is a newly created report that has not yet been saved
  const [isNew, setIsNew] = useState(isNewReport);

  useEffect(() => {
    setIsNew(isNewReport);
  }, [isNewReport]);

  // UI States
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Pin Location widget states
  const [isLocating, setIsLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  // History modal state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Delete confirmation dialog
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const parsed = parseJobReference(report.jobReference || '', isNewReport);
    setJobPrefix(parsed.prefix);
    setJobNumber(parsed.number);
    setJobReference(report.jobReference || (parsed.prefix + parsed.number));
    setReportName(report.reportName || '');
    setClientName(report.clientName || '');
    setAddress(report.address || '');
    setReportDate(report.reportDate || '');
    setStatus(report.status || 'Draft');
    setInspectionDate(report.inspectionDate || '');
    setReportImage(report.reportImage || '');
  }, [report, isNewReport]);

  useEffect(() => {
    setIsNew(isNewReport);
  }, [isNewReport]);

  // Handle number input change after the protected prefix
  const handleJobNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    // If the user pasted a reference containing the prefix, strip it so it doesn't get duplicated
    if (jobPrefix && val.toLowerCase().startsWith(jobPrefix.toLowerCase())) {
      val = val.slice(jobPrefix.length);
    }
    setJobNumber(val);
    const fullRef = jobPrefix ? `${jobPrefix}${val}` : val;
    setJobReference(fullRef);
  };

  // Compress image to manageable web resolution
  const compressImageFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1400;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(e.target?.result as string);
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingImage(true);
    try {
      const compressed = await compressImageFile(file);
      setReportImage(compressed);
    } catch (err) {
      console.error('Failed to process image:', err);
    } finally {
      setIsProcessingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCameraFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingImage(true);
    try {
      const compressed = await compressImageFile(file);
      setReportImage(compressed);
    } catch (err) {
      console.error('Failed to process camera photo:', err);
    } finally {
      setIsProcessingImage(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  // Pin Location handler inside the address box
  const handleGetLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocationNotice('GPS not supported on this device.');
      return;
    }
    setIsLocating(true);
    setLocationNotice(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = pos.coords.latitude.toFixed(5);
        const lng = pos.coords.longitude.toFixed(5);
        const pinText = `${lat}, ${lng}`;
        setAddress((prev) => {
          const trimmed = prev.trim();
          if (!trimmed) return pinText;
          if (trimmed.includes(pinText)) return trimmed;
          return `${trimmed} [${pinText}]`;
        });
        setLocationNotice(`Location pinned: ${lat}, ${lng}`);
        setTimeout(() => setLocationNotice(null), 4000);
      },
      (err) => {
        setIsLocating(false);
        console.warn('Geolocation error:', err);
        setLocationNotice('Unable to acquire GPS location. Please check browser permissions.');
        setTimeout(() => setLocationNotice(null), 4000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  // Handle Save
  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      // Check if inspectionDate has changed to append to inspectionDateHistory
      const oldDate = report.inspectionDate;
      const newDate = inspectionDate.trim();
      let updatedHistory = [...report.inspectionDateHistory];

      if (oldDate && newDate && oldDate !== newDate) {
        updatedHistory = [
          ...updatedHistory,
          {
            date: oldDate,
            changedAt: new Date().toISOString(),
          },
        ];
      }

      const updatedReport: Report = {
        ...report,
        jobReference: jobReference.trim(),
        reportName: reportName.trim(),
        clientName: clientName.trim(),
        address: address.trim(),
        reportDate: reportDate.trim(),
        status,
        inspectionDate: newDate,
        inspectionDateHistory: updatedHistory,
        reportImage: reportImage || undefined,
      };

      const isInitialNewReportSave = isNew || isNewReport;
      const success = await onSaveReport(updatedReport);
      if (success) {
        setIsNew(false);
        setSaveSuccess(true);
        if (isInitialNewReportSave) {
          // Automatic transition to Issues for a newly created report completing Step 1
          onOpenIssuesList();
        } else {
          setTimeout(() => setSaveSuccess(false), 3000);
        }
      } else {
        setSaveError('Failed to save report to database. Please retry.');
      }
    } catch (err: any) {
      setSaveError(err.message || 'An error occurred while saving report.');
    } finally {
      setIsSaving(false);
    }
  };

  // Export Report (PDF or DOCX) from Report Detail
  const handleSelectExportFormat = async (format: 'pdf' | 'docx') => {
    setIsExporting(true);
    setExportingFormat(format);
    setExportFeedback(null);
    setIsExportDialogOpen(false);

    try {
      if (format === 'pdf') {
        await exportPhotoReportPdf(report);
        setExportFeedback({ type: 'success', text: 'PDF Photo Report generated successfully.' });
      } else {
        await exportPhotoReportDocx(report);
        setExportFeedback({ type: 'success', text: 'DOCX Photo Report generated successfully.' });
      }
      setTimeout(() => setExportFeedback(null), 5000);
    } catch (err: any) {
      console.error('Export error:', err);
      setExportFeedback({
        type: 'error',
        text: err?.message || `Failed to export ${format.toUpperCase()} photo report. Please try again.`,
      });
      setTimeout(() => setExportFeedback(null), 6000);
    } finally {
      setIsExporting(false);
      setExportingFormat(null);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const ok = await onDeleteReport(report.id);
      if (!ok) {
        setDeleteError('Failed to delete report. Please try again.');
        setIsDeleting(false);
      }
      // If ok, parent navigates back to Reports Home
    } catch (err: any) {
      setDeleteError(err.message || 'Error occurred while deleting report.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto px-4 py-4 sm:px-6 sm:py-6 space-y-6 sm:space-y-8">
      {/* Top navigation: Compact, subtle border */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#0E1E2B]/10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#0E1E2B]/15 bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] text-[#0E1E2B] font-mono font-bold text-xs uppercase tracking-wider touch-manipulation min-h-[44px] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30"
          aria-label="Return to reports home"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
          <span>REPORTS</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/50 hidden sm:inline-block">
            REF:
          </span>
          <span className="font-mono font-bold text-xs sm:text-sm text-[#0E1E2B] bg-white px-2.5 py-1 rounded-md border border-[#0E1E2B]/15 inline-block">
            {jobReference || report.jobReference || 'BBC26-??'}
          </span>
        </div>
      </div>

      {/* 1. REPORT SUMMARY: Sky Cyan surface with clear editorial hierarchy */}
      <header className="w-full bg-[#B2E5F6] border border-[#0E1E2B]/15 rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
            <span className="text-[10px] sm:text-[11px] font-mono font-bold tracking-[0.2em] uppercase text-[#0E1E2B]/70 block">
              {isNew ? 'NEW REPORT · STEP 1 OF INSPECTION' : 'REPORT'}
            </span>
            <div className="font-mono font-bold text-sm sm:text-base text-[#0E1E2B] tracking-tight uppercase">
              {jobReference || report.jobReference || 'BBC26-123'}
            </div>
            <h1
              title={reportName || 'Building Condition Inspection'}
              className="text-lg sm:text-xl md:text-2xl font-brand font-bold text-[#0E1E2B] tracking-tight leading-snug break-normal line-clamp-3 pt-0.5"
            >
              {reportName || <span className="text-[#0E1E2B]/40 font-normal font-sans text-base">Building Condition Inspection</span>}
            </h1>
          </div>
          <AssuredLogo className="h-5 sm:h-6 shrink-0 opacity-90 hidden sm:inline-flex mt-0.5" />
        </div>

        <div className="pt-2.5 sm:pt-3 border-t border-[#0E1E2B]/15 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 text-xs text-[#0E1E2B]">
          <div className="min-w-0">
            <span className="font-mono uppercase text-[10px] tracking-wider text-[#0E1E2B]/65 block font-semibold">
              CLIENT / SITE
            </span>
            <span className="text-[#0E1E2B] font-medium truncate block mt-0.5 text-xs sm:text-sm">
              {clientName || address ? `${clientName || ''}${clientName && address ? ' — ' : ''}${address || ''}` : 'Not specified'}
            </span>
          </div>
          <div className="min-w-0">
            <span className="font-mono uppercase text-[10px] tracking-wider text-[#0E1E2B]/65 block font-semibold">
              INSPECTION
            </span>
            <span className="font-mono text-[#0E1E2B] font-semibold block mt-0.5 text-xs sm:text-sm">
              {inspectionDate || 'Not set'}
            </span>
          </div>
          <div className="min-w-0">
            <span className="font-mono uppercase text-[10px] tracking-wider text-[#0E1E2B]/65 block font-semibold mb-1">
              STATUS
            </span>
            <StatusBadge status={status} size="sm" />
          </div>
        </div>
      </header>

      {/* 2. SECTION HIERARCHY: REPORT INFORMATION */}
      <section className="space-y-4 pt-1">
        {/* Editorial Section Heading */}
        <div className="border-b border-[#0E1E2B]/10 pb-2 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#0E1E2B]">
              REPORT INFORMATION
            </h2>
          </div>
          {isNew && (
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#628EF7] bg-[#628EF7]/10 px-2 py-0.5 rounded shrink-0">
              Step 1 of inspection
            </span>
          )}
        </div>

        {/* Inputs sitting cleanly with restrained 1px borders */}
        <div className="space-y-4">
          {/* Job Reference & Report Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                Job Reference <span className="text-rose-600">*</span>
              </label>
              {jobPrefix ? (
                <div className="flex items-stretch w-full bg-white border border-[#0E1E2B]/20 rounded-lg focus-within:border-[#628EF7] focus-within:ring-2 focus-within:ring-[#628EF7]/20 transition-all overflow-hidden min-h-[44px] sm:min-h-[48px]">
                  <span
                    className="inline-flex items-center px-3 sm:px-3.5 bg-slate-100/90 border-r border-[#0E1E2B]/15 font-mono font-bold text-sm sm:text-base text-[#0E1E2B] select-none shrink-0 tracking-wider"
                    title={`Automatic ${jobPrefix} prefix`}
                  >
                    {jobPrefix}
                  </span>
                  <input
                    type="text"
                    id="input_job_reference_number"
                    value={jobNumber}
                    onChange={handleJobNumberChange}
                    placeholder="123"
                    className="w-full font-mono font-bold text-sm sm:text-base px-3 sm:px-3.5 py-2.5 sm:py-3 bg-transparent text-[#0E1E2B] outline-none placeholder:text-[#0E1E2B]/35 placeholder:font-normal"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  id="input_job_reference"
                  value={jobReference}
                  onChange={e => setJobReference(e.target.value)}
                  placeholder="Job Reference"
                  className="w-full font-mono font-bold text-sm sm:text-base px-3.5 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] sm:min-h-[48px]"
                />
              )}
            </div>

            <div>
              <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                Report Name
              </label>
              <input
                type="text"
                value={reportName}
                onChange={e => setReportName(e.target.value)}
                placeholder="e.g. Roof & Gutter Structural Inspection"
                className="w-full text-sm sm:text-base font-normal px-3.5 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] sm:min-h-[48px]"
              />
            </div>
          </div>

          {/* Client Name & Prepared By */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                Client Name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="e.g. Acme Commercial Properties Ltd"
                className="w-full text-sm sm:text-base font-normal px-3.5 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] sm:min-h-[48px]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                Prepared By
              </label>
              <input
                type="text"
                value="Assured Consultancy Pty Ltd"
                readOnly
                disabled
                className="w-full text-sm sm:text-base font-medium px-3.5 py-2.5 sm:py-3 bg-[#F4F6F8] border border-[#0E1E2B]/15 rounded-lg text-[#0E1E2B]/80 cursor-not-allowed select-none min-h-[44px] sm:min-h-[48px]"
                title="Prepared by is permanently set to Assured Consultancy Pty Ltd"
              />
            </div>
          </div>

          {/* Address / Site Location with Pin Location control */}
          <div>
            <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
              Address / Site Location
            </label>
            <div className="relative">
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="e.g. 144 High Street, Sector 4"
                className="w-full text-sm sm:text-base font-normal pl-3.5 pr-12 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] sm:min-h-[48px]"
              />
              <button
                type="button"
                onClick={handleGetLocation}
                disabled={isLocating}
                title="Pin current GPS coordinates"
                aria-label="Pin current GPS coordinates"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-md bg-[#F4F6F8] hover:bg-[#E5E8EB] active:bg-[#C6CBD1]/60 text-[#0E1E2B] flex items-center justify-center border border-[#0E1E2B]/15 transition-all touch-manipulation focus:outline-none focus:ring-2 focus:ring-[#628EF7]/40 cursor-pointer"
              >
                {isLocating ? (
                  <span className="w-3.5 h-3.5 border-2 border-[#0E1E2B]/30 border-t-[#628EF7] rounded-full animate-spin" />
                ) : (
                  <MapPin className="w-4 h-4 stroke-[2] text-[#628EF7]" />
                )}
              </button>
            </div>
            {locationNotice && (
              <p className="text-xs font-semibold text-[#628EF7] mt-1.5 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>{locationNotice}</span>
              </p>
            )}
          </div>

          {/* Report Cover Image: Clean outlined area */}
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80">
                Report Cover Image
              </label>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageFileChange}
            />

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleCameraFileChange}
            />

            {reportImage ? (
              <div className="rounded-lg overflow-hidden border border-[#0E1E2B]/20 bg-[#0E1E2B]">
                <div className="h-44 sm:h-52 w-full flex items-center justify-center bg-[#0E1E2B]">
                  <img
                    src={reportImage}
                    alt="Report cover"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>

                <div className="p-2.5 sm:p-3 bg-[#0E1E2B] text-white flex flex-wrap items-center justify-between gap-2 border-t border-white/10">
                  <div className="flex items-center gap-2 text-xs font-bold text-white/90">
                    <ImageIcon className="w-4 h-4 text-[#B2E5F6] shrink-0" />
                    <span>Cover Photo Active</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessingImage}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 active:bg-white/30 text-white text-xs font-semibold transition-all cursor-pointer touch-manipulation min-h-[36px]"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Change</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={isProcessingImage}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 active:bg-white/30 text-white text-xs font-semibold transition-all cursor-pointer touch-manipulation min-h-[36px]"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Camera</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setReportImage('')}
                      className="inline-flex items-center justify-center p-2 rounded-md bg-rose-600/85 hover:bg-rose-600 text-white transition-all cursor-pointer touch-manipulation min-h-[36px] min-w-[36px]"
                      title="Remove report cover image"
                      aria-label="Remove report cover image"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-[#0E1E2B]/20 rounded-lg p-4 sm:p-5 bg-white text-center">
                <div className="w-10 h-10 rounded-full bg-[#F4F6F8] border border-[#0E1E2B]/10 flex items-center justify-center mx-auto mb-2 text-[#0E1E2B]/60">
                  <ImagePlus className="w-5 h-5 stroke-[1.8]" />
                </div>
                <p className="text-xs font-medium text-[#0E1E2B] mb-3">
                  Upload an existing cover photograph or capture on site
                </p>
                <div className="flex flex-col sm:flex-row gap-2 max-w-sm mx-auto">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessingImage}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#0E1E2B]/20 hover:border-[#0E1E2B] bg-white hover:bg-[#F4F6F8] text-[#0E1E2B] font-bold text-xs uppercase tracking-wider transition-all cursor-pointer touch-manipulation focus:outline-none focus:ring-1 focus:ring-[#628EF7] min-h-[44px]"
                  >
                    <Upload className="w-3.5 h-3.5 stroke-[2.2]" />
                    <span>Upload Image</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isProcessingImage}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#0E1E2B]/20 hover:border-[#0E1E2B] bg-white hover:bg-[#F4F6F8] text-[#0E1E2B] font-bold text-xs uppercase tracking-wider transition-all cursor-pointer touch-manipulation focus:outline-none focus:ring-1 focus:ring-[#628EF7] min-h-[44px]"
                  >
                    <Camera className="w-3.5 h-3.5 stroke-[2.2]" />
                    <span>Take Photo</span>
                  </button>
                </div>
              </div>
            )}

            {isProcessingImage && (
              <p className="text-xs text-[#628EF7] font-semibold flex items-center gap-1.5 animate-pulse pt-1">
                <span className="w-3.5 h-3.5 border-2 border-[#0E1E2B]/20 border-t-[#628EF7] rounded-full animate-spin shrink-0" />
                <span>Optimizing cover image...</span>
              </p>
            )}

            {/* Save Report Information - Repositioned immediately after Report Information fields with electric blue styling */}
            <div className="pt-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className={`w-full py-3.5 px-5 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[48px] sm:min-h-[52px] flex items-center justify-center gap-2 transition-colors touch-manipulation cursor-pointer active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-[#628EF7]/25 shadow-xs ${
                  saveSuccess
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white'
                } ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {isSaving ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Saving Report Information...</span>
                  </>
                ) : saveSuccess ? (
                  <>
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>Report Information Saved</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 stroke-[2.2]" />
                    <span>Save Report Information</span>
                  </>
                )}
              </button>

              {saveError && (
                <div className="mt-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 3. SECTION HIERARCHY: SCHEDULE & STATUS */}
      {!isNew && (
        <section className="space-y-4 pt-2">
          {/* Editorial Section Heading */}
          <div className="border-b border-[#0E1E2B]/10 pb-2">
            <h2 className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#0E1E2B]">
              SCHEDULE &amp; STATUS
            </h2>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Report Date */}
              <div>
                <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                  Report Date
                </label>
                <input
                  type="date"
                  value={reportDate}
                  onChange={e => setReportDate(e.target.value)}
                  className="w-full text-sm sm:text-base font-normal px-3.5 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] sm:min-h-[48px]"
                />
              </div>

              {/* Status Dropdown */}
              <div>
                <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                  Report Status
                </label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value as ReportStatus)}
                  className="w-full text-sm sm:text-base font-medium px-3.5 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] sm:min-h-[48px]"
                >
                  {ALL_REPORT_STATUSES.map(st => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Inspection Date with History */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80">
                  Inspection Date
                </label>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0E1E2B] hover:text-[#628EF7] bg-white hover:bg-[#F4F6F8] px-2.5 py-1 rounded-md border border-[#0E1E2B]/15 transition-colors touch-manipulation min-h-[32px] cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>History ({report.inspectionDateHistory?.length || 0})</span>
                </button>
              </div>
              <input
                type="date"
                value={inspectionDate}
                onChange={e => setInspectionDate(e.target.value)}
                className="w-full text-sm sm:text-base font-mono font-medium px-3.5 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] sm:min-h-[48px]"
              />
            </div>
          </div>
        </section>
      )}

      {/* 4. SECTION HIERARCHY: ISSUES (Contextual navigation to dedicated Issues page with Assured Cyan treatment) */}
      {!isNew && (
        <section className="pt-2">
          <div
            id="report-issues-nav-entry"
            role="button"
            tabIndex={0}
            onClick={onOpenIssuesList}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenIssuesList();
              }
            }}
            className="group w-full p-5 sm:p-6 bg-[#EDF8FA] rounded-xl border border-[#94D6E7] hover:border-[#58B9D4] hover:bg-[#E2F4F7] active:bg-[#D7EFF3] transition-colors cursor-pointer touch-manipulation focus:outline-none focus:ring-2 focus:ring-[#0E7490]/30 block shadow-2xs active:scale-[0.99]"
            aria-label="Review and manage inspection issues"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <span className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-[#0E7490] block">
                  ISSUES
                </span>
                <p className="text-lg sm:text-xl font-brand font-bold text-[#0E1E2B] leading-snug">
                  {issues.length === 1 ? '1 issue recorded' : `${issues.length} issues recorded`}
                </p>
              </div>

              <div className="flex items-center text-[#0E7490] group-hover:translate-x-0.5 transition-transform shrink-0">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 5. SECTION HIERARCHY: REPORT OUTPUT (Final step, visually quieter) */}
      {!isNew && (
        <section className="space-y-4 pt-2">
          {/* Editorial Section Heading */}
          <div className="border-b border-[#0E1E2B]/10 pb-2">
            <h2 className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#0E1E2B]">
              REPORT OUTPUT
            </h2>
          </div>

          <div className="bg-white rounded-xl border border-[#0E1E2B]/15 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm sm:text-base font-bold text-[#0E1E2B] tracking-tight">
                Photo Report
              </h3>
              <p className="text-xs text-[#0E1E2B]/65 font-normal">
                Generate the official Assured Capture photo report.
              </p>
            </div>

            {/* Primary Action: Export Photo Report */}
            <button
              type="button"
              onClick={() => setIsExportDialogOpen(true)}
              disabled={isExporting}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 rounded-lg bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] text-[#0E1E2B] border border-[#0E1E2B]/20 hover:border-[#0E1E2B] font-bold text-xs uppercase tracking-wider transition-colors touch-manipulation min-h-[44px] shrink-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#628EF7]"
            >
              {isExporting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-[#0E1E2B]/30 border-t-[#628EF7] rounded-full animate-spin" />
                  <span>Generating {exportingFormat === 'pdf' ? 'PDF' : 'DOCX'}...</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4 text-[#628EF7] stroke-[2.2]" />
                  <span>Export Photo Report</span>
                </>
              )}
            </button>
          </div>

          {exportFeedback && (
            <div
              className={`p-3.5 rounded-lg text-xs font-semibold flex items-center gap-2.5 border ${
                exportFeedback.type === 'success'
                  ? 'bg-[#8CBFAE]/20 text-[#0E1E2B] border-[#8CBFAE]'
                  : 'bg-[#F4B9AD]/25 text-[#0E1E2B] border-[#F4B9AD]'
              }`}
            >
              {exportFeedback.type === 'success' ? (
                <Check className="w-4 h-4 text-[#0E1E2B] shrink-0 stroke-[2.5]" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[#C86D51] shrink-0 stroke-[2.5]" />
              )}
              <span>{exportFeedback.text}</span>
            </div>
          )}
        </section>
      )}

      {/* 6. DESTRUCTIVE ACTION: Subtle danger treatment with adequate whitespace */}
      <div className="pt-6 sm:pt-8 border-t border-[#0E1E2B]/10">
        <button
          type="button"
          onClick={() => setIsDeleteDialogOpen(true)}
          className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-rose-50/60 active:bg-rose-100/60 border border-[#0E1E2B]/15 hover:border-rose-300 text-[#0E1E2B]/70 hover:text-rose-700 font-semibold text-xs min-h-[44px] transition-colors touch-manipulation cursor-pointer flex items-center justify-center gap-2"
        >
          <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
          <span>Delete Report</span>
        </button>

        {deleteError && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs font-semibold">
            {deleteError}
          </div>
        )}
      </div>

      {/* Reusable Confirmation Dialog for Delete Report */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        title="Delete Report"
        message="Delete this report?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsDeleteDialogOpen(false)}
      />

      {/* Format Selection Dialog for Photo Report Export */}
      <ExportFormatDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onSelectFormat={handleSelectExportFormat}
        isExporting={isExporting}
        exportingFormat={exportingFormat}
      />

      {/* Inspection Date History Audit Modal */}
      <InspectionHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        currentInspectionDate={inspectionDate}
        history={report.inspectionDateHistory || []}
      />
    </div>
  );
};
