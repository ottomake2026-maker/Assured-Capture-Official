import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  X,
  FileDown,
  Loader2,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronLeft,
  FileText,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Report, Issue, Photo } from '../types';
import { buildPhotoReportPdf, exportPhotoReportPdf } from '../utils/pdfExport';
import { exportPhotoReportDocx, getReportJobReference } from '../utils/docxExport';

// Configure pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PhotoReportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: Report;
  issues?: Issue[];
  photos?: Photo[];
  onOpenExportDialog?: () => void;
}

interface RenderedPage {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export const PhotoReportPreviewModal: React.FC<PhotoReportPreviewModalProps> = ({
  isOpen,
  onClose,
  report,
  issues,
  photos,
  onOpenExportDialog,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [scaleMultiplier, setScaleMultiplier] = useState<number>(1);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [isExportingDocx, setIsExportingDocx] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pagesContainerRef = useRef<HTMLDivElement>(null);

  // Load and render PDF pages in memory whenever modal opens
  const loadPdfPreview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setPages([]);

    try {
      // 1. Build the canonical PDF using the single source of truth
      const doc = await buildPhotoReportPdf(report, issues, photos);
      const pdfArrayBuffer = doc.output('arraybuffer');

      // 2. Load PDF document in pdfjs
      const loadingTask = pdfjsLib.getDocument({
        data: pdfArrayBuffer,
        useSystemFonts: true,
      });

      const pdfDoc = await loadingTask.promise;
      const numPages = pdfDoc.numPages;
      setTotalPages(numPages);

      const renderedPagesList: RenderedPage[] = [];

      // Render all pages sequentially into high-DPI canvases
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        // Base viewport at 2x scale for crisp rendering on retina/mobile screens
        const renderScale = 2.0;
        const viewport = page.getViewport({ scale: renderScale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d', { alpha: false });

        if (context) {
          const renderContext = {
            canvasContext: context,
            viewport: viewport,
            canvas: canvas,
          };
          await page.render(renderContext).promise;
        }

        renderedPagesList.push({
          pageNumber: pageNum,
          canvas,
          width: viewport.width,
          height: viewport.height,
        });
      }

      setPages(renderedPagesList);
    } catch (err: any) {
      console.error('Failed to generate PDF preview:', err);
      setError(
        err?.message ||
          'Failed to render the Photo Report preview. Please try again or export directly.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [report, issues, photos]);

  useEffect(() => {
    if (isOpen) {
      setScaleMultiplier(1);
      loadPdfPreview();
    } else {
      // Clean up canvases and state on close
      setPages([]);
      setError(null);
    }
  }, [isOpen, loadPdfPreview]);

  // Handle direct PDF export from preview header
  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      await exportPhotoReportPdf(report, issues, photos);
    } catch (err) {
      console.error('Failed to export PDF from preview:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Handle direct DOCX export from preview header
  const handleExportDocx = async () => {
    if (isExportingDocx) return;
    setIsExportingDocx(true);
    try {
      await exportPhotoReportDocx(report, issues, photos);
    } catch (err) {
      console.error('Failed to export DOCX from preview:', err);
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleZoomIn = () => {
    setScaleMultiplier((prev) => Math.min(prev + 0.15, 1.6));
  };

  const handleZoomOut = () => {
    setScaleMultiplier((prev) => Math.max(prev - 0.15, 0.65));
  };

  const handleResetZoom = () => {
    setScaleMultiplier(1);
  };

  if (!isOpen) return null;

  const jobRef = getReportJobReference(report);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0B151E]/90 backdrop-blur-[2px] animate-in fade-in duration-150 select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-report-title"
    >
      {/* 1. TOP NAVIGATION / CONTROLS BAR */}
      <header className="shrink-0 bg-[#0E1E2B] border-b border-[#203748] px-3 sm:px-5 py-2.5 sm:py-3 flex items-center justify-between gap-2 shadow-md">
        {/* Left: Back / Close button & Report Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/25 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer touch-manipulation min-h-[36px]"
            aria-label="Back to Report Output"
          >
            <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
            <span className="hidden xs:inline">Back</span>
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs font-mono font-bold uppercase tracking-wider text-[#94D6E7]">
                PREVIEW
              </span>
              {totalPages > 0 && (
                <span className="text-[10px] sm:text-xs font-mono bg-white/10 text-white/80 px-2 py-0.5 rounded-full">
                  {totalPages} {totalPages === 1 ? 'page' : 'pages'}
                </span>
              )}
            </div>
            <h2
              id="preview-report-title"
              className="text-xs sm:text-sm font-brand font-bold text-white truncate max-w-[160px] sm:max-w-xs md:max-w-md"
            >
              {jobRef || 'Photo Report'}
            </h2>
          </div>
        </div>

        {/* Center: Zoom Controls (hidden on very small screens to preserve space) */}
        <div className="hidden md:flex items-center gap-1 bg-[#182B3A] p-1 rounded-lg border border-[#203748]">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={scaleMultiplier <= 0.7 || isLoading}
            className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 cursor-pointer"
            title="Zoom Out"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            disabled={isLoading}
            className="px-2 py-1 text-[11px] font-mono font-bold text-white/90 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
            title="Reset Zoom"
          >
            {Math.round(scaleMultiplier * 100)}%
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={scaleMultiplier >= 1.5 || isLoading}
            className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 cursor-pointer"
            title="Zoom In"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Export Actions & Close */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Quick Export PDF */}
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isLoading || isExportingPdf || isExportingDocx}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-xs disabled:opacity-50 min-h-[36px]"
            title="Export as PDF"
          >
            {isExportingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5 stroke-[2.2]" />
            )}
            <span className="hidden sm:inline">Export</span> PDF
          </button>

          {/* Quick Export DOCX */}
          <button
            type="button"
            onClick={handleExportDocx}
            disabled={isLoading || isExportingPdf || isExportingDocx}
            className="hidden xs:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2B5AC5] hover:bg-[#3B6BD5] active:bg-[#2049A8] text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-xs disabled:opacity-50 min-h-[36px]"
            title="Export as DOCX"
          >
            {isExportingDocx ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileDown className="w-3.5 h-3.5 stroke-[2.2]" />
            )}
            <span className="hidden sm:inline">Export</span> DOCX
          </button>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer touch-manipulation min-h-[36px] min-w-[36px] flex items-center justify-center ml-1"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 2. DOCUMENT SCROLLING CANVAS STAGE */}
      <main
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 md:p-8 bg-[#182430] flex flex-col items-center"
      >
        {/* Loading State */}
        {isLoading && (
          <div className="my-auto py-16 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-[#94D6E7] animate-spin" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-white tracking-wide">
                Rendering Photo Report Preview
              </p>
              <p className="text-xs text-white/60">
                Compiling document pages and evidence layout...
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {!isLoading && error && (
          <div className="my-auto max-w-md p-6 bg-rose-950/40 border border-rose-800/60 rounded-xl text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-900/40 border border-rose-700/60 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-rose-400" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Preview Generation Failed</h3>
              <p className="text-xs text-rose-200/80">{error}</p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={loadPdfPreview}
                className="px-4 py-2 bg-white text-[#0E1E2B] hover:bg-slate-100 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Retry Preview
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Export PDF Directly
              </button>
            </div>
          </div>
        )}

        {/* Multi-page continuous vertical document stream */}
        {!isLoading && !error && pages.length > 0 && (
          <div
            ref={pagesContainerRef}
            className="w-full flex flex-col items-center gap-6 sm:gap-8 pb-12 transition-transform duration-150"
            style={{
              maxWidth: `${Math.round(680 * scaleMultiplier)}px`,
            }}
          >
            {pages.map((page) => (
              <div
                key={page.pageNumber}
                className="w-full flex flex-col items-center group relative"
              >
                {/* Page header tag */}
                <div className="w-full flex items-center justify-between text-[11px] font-mono text-white/50 px-1 mb-1.5 select-none">
                  <span>
                    PAGE {page.pageNumber} OF {totalPages}
                  </span>
                  <span className="text-[10px] text-white/30 uppercase">
                    Letter • 8.5&quot; × 11&quot;
                  </span>
                </div>

                {/* Page Card with authentic Letter aspect ratio (612 x 792) */}
                <div className="w-full bg-white rounded shadow-2xl overflow-hidden border border-slate-700/50 transition-shadow">
                  <CanvasPageViewer canvas={page.canvas} />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 3. MOBILE FLOATING ACTION BAR */}
      <footer className="shrink-0 sm:hidden bg-[#0E1E2B] border-t border-[#203748] p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-mono text-white/70">
          <span>{totalPages} Pages</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isLoading || isExportingPdf}
            className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5"
          >
            {isExportingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={handleExportDocx}
            disabled={isLoading || isExportingDocx}
            className="px-3.5 py-2 rounded-lg bg-[#2B5AC5] hover:bg-[#3B6BD5] text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5"
          >
            {isExportingDocx ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileDown className="w-3.5 h-3.5" />
            )}
            <span>DOCX</span>
          </button>
        </div>
      </footer>
    </div>
  );
};

/**
 * Subcomponent to mount rendered HTMLCanvas into DOM
 */
const CanvasPageViewer: React.FC<{ canvas: HTMLCanvasElement }> = ({ canvas }) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    mount.innerHTML = '';
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    mount.appendChild(canvas);

    return () => {
      if (mount) mount.innerHTML = '';
    };
  }, [canvas]);

  return <div ref={mountRef} className="w-full select-none" />;
};
