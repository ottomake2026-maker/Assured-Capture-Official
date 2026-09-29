import React from 'react';
import { X, FileText, FileDown, Loader2 } from 'lucide-react';

interface ExportFormatDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFormat: (format: 'pdf' | 'docx') => void;
  isExporting: boolean;
  exportingFormat: 'pdf' | 'docx' | null;
}

export const ExportFormatDialog: React.FC<ExportFormatDialogProps> = ({
  isOpen,
  onClose,
  onSelectFormat,
  isExporting,
  exportingFormat,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0E1E2B]/40 backdrop-blur-[1px] animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isExporting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-format-dialog-title"
    >
      <div className="w-full max-w-sm bg-white rounded-xl border border-[#0E1E2B]/15 shadow-xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 pb-3 border-b border-[#0E1E2B]/10 flex items-center justify-between">
          <h3
            id="export-format-dialog-title"
            className="text-base font-brand font-bold text-[#0E1E2B]"
          >
            Choose export format
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="p-1.5 -mr-1 text-[#0E1E2B]/50 hover:text-[#0E1E2B] rounded-lg transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Options */}
        <div className="p-4 sm:p-5 space-y-2.5">
          {/* PDF Option */}
          <button
            type="button"
            onClick={() => onSelectFormat('pdf')}
            disabled={isExporting}
            className="w-full p-3.5 rounded-lg border border-[#0E1E2B]/15 hover:border-[#628EF7] hover:bg-[#F4F6F8] active:bg-[#EDF4FF] transition-all flex items-center justify-between text-left cursor-pointer group disabled:opacity-50 touch-manipulation min-h-[58px]"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <FileText className="w-4.5 h-4.5 stroke-[2.2]" />
              </div>
              <div>
                <span className="block font-bold text-sm text-[#0E1E2B]">PDF</span>
                <span className="block text-xs text-[#0E1E2B]/60 font-medium">Fixed, print-ready inspection report</span>
              </div>
            </div>
            {isExporting && exportingFormat === 'pdf' && (
              <Loader2 className="w-4 h-4 text-[#628EF7] animate-spin shrink-0" />
            )}
          </button>

          {/* DOCX Option */}
          <button
            type="button"
            onClick={() => onSelectFormat('docx')}
            disabled={isExporting}
            className="w-full p-3.5 rounded-lg border border-[#0E1E2B]/15 hover:border-[#628EF7] hover:bg-[#F4F6F8] active:bg-[#EDF4FF] transition-all flex items-center justify-between text-left cursor-pointer group disabled:opacity-50 touch-manipulation min-h-[58px]"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 text-[#2B5AC5] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <FileDown className="w-4.5 h-4.5 stroke-[2.2]" />
              </div>
              <div>
                <span className="block font-bold text-sm text-[#0E1E2B]">DOCX</span>
                <span className="block text-xs text-[#0E1E2B]/60 font-medium">Editable Word document</span>
              </div>
            </div>
            {isExporting && exportingFormat === 'docx' && (
              <Loader2 className="w-4 h-4 text-[#628EF7] animate-spin shrink-0" />
            )}
          </button>
        </div>

        {/* Footer with Cancel */}
        <div className="p-3 bg-[#F4F6F8] border-t border-[#0E1E2B]/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="w-full sm:w-auto px-4 py-2 rounded-lg bg-white border border-[#0E1E2B]/20 hover:bg-[#F4F6F8] text-[#0E1E2B] font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer min-h-[38px] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
