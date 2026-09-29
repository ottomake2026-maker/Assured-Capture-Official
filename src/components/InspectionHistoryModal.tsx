import React from 'react';
import { InspectionDateHistoryRecord } from '../types';
import { History, X, Calendar, Clock } from 'lucide-react';

interface InspectionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentInspectionDate: string;
  history: InspectionDateHistoryRecord[];
}

export const InspectionHistoryModal: React.FC<InspectionHistoryModalProps> = ({
  isOpen,
  onClose,
  currentInspectionDate,
  history,
}) => {
  if (!isOpen) return null;

  // Newest history entries should appear first
  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0E1E2B]/40 backdrop-blur-[1px] animate-in fade-in duration-150"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
    >
      <div className="w-full max-w-lg bg-white rounded-xl border border-[#0E1E2B]/15 shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#0E1E2B]/10 flex items-center justify-between bg-[#F4F6F8]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#B2E5F6]/40 text-[#0E1E2B] rounded-lg">
              <History className="w-5 h-5 text-[#628EF7]" />
            </div>
            <div>
              <h3 id="history-modal-title" className="text-base font-brand font-bold text-[#0E1E2B]">
                Inspection Date History
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#0E1E2B]/50 hover:text-[#0E1E2B] rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center cursor-pointer transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Active Date Banner */}
        <div className="px-5 py-3 bg-[#B2E5F6]/20 border-b border-[#B2E5F6]/40 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#0E1E2B] font-semibold text-xs">
            <Calendar className="w-4 h-4 text-[#628EF7]" />
            <span>Current Inspection Date:</span>
          </div>
          <span className="font-mono font-bold text-sm text-[#0E1E2B] px-2.5 py-1 bg-white border border-[#0E1E2B]/20 rounded-md">
            {currentInspectionDate || 'Not specified'}
          </span>
        </div>

        {/* Historical records list */}
        <div className="p-5 overflow-y-auto space-y-2.5 flex-1">
          {sortedHistory.length === 0 ? (
            <div className="text-center py-10 px-4">
              <History className="w-10 h-10 text-[#0E1E2B]/30 mx-auto mb-2 stroke-[1.5]" />
              <p className="text-sm font-semibold text-[#0E1E2B]">No inspection date changes recorded</p>
            </div>
          ) : (
            sortedHistory.map((item, idx) => {
              const changeDate = new Date(item.changedAt);
              const formattedChangeTime = !isNaN(changeDate.getTime())
                ? changeDate.toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : item.changedAt;

              return (
                <div
                  key={idx}
                  className="p-3.5 bg-[#F4F6F8] border border-[#0E1E2B]/10 rounded-lg flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#0E1E2B]/50">
                      Previous Date
                    </span>
                    <span className="font-mono text-xs font-bold text-[#0E1E2B] bg-white px-2 py-0.5 border border-[#0E1E2B]/20 rounded">
                      {item.date}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[#0E1E2B]/70 mt-0.5">
                    <Clock className="w-3.5 h-3.5 text-[#0E1E2B]/40 shrink-0" />
                    <span>Changed at: <strong className="text-[#0E1E2B]">{formattedChangeTime}</strong></span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#F4F6F8] border-t border-[#0E1E2B]/10">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-lg bg-[#0E1E2B] hover:bg-[#1A2E3D] text-white font-bold text-sm min-h-[44px] shadow-sm transition-colors touch-manipulation cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
