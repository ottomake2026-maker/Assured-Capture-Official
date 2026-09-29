import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  isDestructive = true,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0E1E2B]/40 backdrop-blur-[1px] animate-in fade-in duration-150"
      onClick={e => {
        if (e.target === e.currentTarget && !isLoading) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md bg-white rounded-xl border border-[#0E1E2B]/15 shadow-xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header with icon */}
        <div className="p-5 pb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${isDestructive ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-[#B2E5F6]/40 text-[#0E1E2B] border border-[#628EF7]/30'}`}>
              <AlertTriangle className="w-5 h-5 shrink-0" />
            </div>
            <div>
              <h3 id="confirm-dialog-title" className="text-base sm:text-lg font-brand font-bold text-[#0E1E2B] leading-snug">
                {title}
              </h3>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="p-2 -mr-1 -mt-1 text-[#0E1E2B]/50 hover:text-[#0E1E2B] rounded-lg touch-manipulation min-w-[40px] min-h-[40px] flex items-center justify-center cursor-pointer transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message */}
        <div className="px-5 py-2">
          <p className="text-sm text-[#0E1E2B]/80 leading-relaxed font-normal">
            {message}
          </p>
        </div>

        {/* Actions - Glove friendly buttons */}
        <div className="p-4 sm:p-5 pt-4 bg-[#F4F6F8] border-t border-[#0E1E2B]/10 flex flex-col sm:flex-row-reverse gap-2.5">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-lg font-bold text-sm min-h-[44px] flex items-center justify-center gap-2 transition-colors touch-manipulation active:scale-[0.98] cursor-pointer shadow-sm ${
              isDestructive
                ? 'bg-[#E11D48] hover:bg-[#BE123C] text-white focus:ring-4 focus:ring-rose-200'
                : 'bg-[#628EF7] hover:bg-[#4E7AF2] text-white focus:ring-4 focus:ring-[#628EF7]/25'
            } ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg font-bold text-sm min-h-[44px] bg-white border border-[#0E1E2B]/20 text-[#0E1E2B] hover:bg-[#F4F6F8] hover:text-[#0E1E2B] transition-colors touch-manipulation active:scale-[0.98] cursor-pointer"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
