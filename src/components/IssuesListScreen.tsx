import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Report, Issue } from '../types';
import { ArrowLeft, Plus, ChevronRight, Save, AlertCircle, GripVertical } from 'lucide-react';

interface IssuesListScreenProps {
  report: Report;
  issues: Issue[];
  photoCounts: Record<string, number>;
  onBackToReport: () => void;
  onAddIssue: () => void;
  onOpenIssue: (issueId: string) => void;
  onSaveIssues?: () => Promise<boolean> | void;
  onReorderIssues?: (reorderedIssues: Issue[]) => void | Promise<void>;
  isNewReportWorkflow?: boolean;
}

/**
 * Derives a compact, professional register subtitle for an issue:
 * E.g. "Foundation · 3 evidence photos" or "3 evidence photos"
 */
function formatIssueSubtitle(issue: Issue, count: number): string {
  const photoText = count === 1 ? '1 evidence photo' : `${count} evidence photos`;

  // 1. Explicit category or location property if present
  const category = (issue as any).category || (issue as any).location;
  if (category && typeof category === 'string' && category.trim()) {
    return `${category.trim()} · ${photoText}`;
  }

  // 2. Extract concise context from the issue description if available
  if (issue.issueDescription && issue.issueDescription.trim()) {
    const raw = issue.issueDescription.trim();
    // Check for delimiter like bullet, pipe, dash, or newline
    const firstLine = raw.split(/\r?\n/)[0].trim();
    const segment = firstLine.split(/[·|\–—]/)[0].trim();
    if (segment.length > 0 && segment.length <= 40) {
      return `${segment} · ${photoText}`;
    }
    // Check for first sentence fragment
    const sentencePart = segment.split(/[.,;]/)[0].trim();
    if (sentencePart.length > 0 && sentencePart.length <= 35) {
      return `${sentencePart} · ${photoText}`;
    }
    const truncated = raw.length > 32 ? raw.slice(0, 30).trim() + '...' : raw;
    return `${truncated} · ${photoText}`;
  }

  return photoText;
}

export const IssuesListScreen: React.FC<IssuesListScreenProps> = ({
  report,
  issues,
  photoCounts,
  onBackToReport,
  onAddIssue,
  onOpenIssue,
  onSaveIssues,
  onReorderIssues,
  isNewReportWorkflow = false,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Local state initialized with incoming issues sorted by issueNumber
  const [localIssues, setLocalIssues] = useState<Issue[]>(() => {
    return [...issues].sort((a, b) => a.issueNumber - b.issueNumber);
  });

  // Keep local issues in sync with prop updates
  useEffect(() => {
    setLocalIssues([...issues].sort((a, b) => a.issueNumber - b.issueNumber));
  }, [issues]);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragItemRef = useRef<number | null>(null);
  const touchActiveIndexRef = useRef<number | null>(null);

  const moveIssueItem = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (
        fromIdx === toIdx ||
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= localIssues.length ||
        toIdx >= localIssues.length
      ) {
        return;
      }

      const updatedList = [...localIssues];
      const [movedItem] = updatedList.splice(fromIdx, 1);
      updatedList.splice(toIdx, 0, movedItem);

      // Re-assign sequential issue numbers: Issue 1, Issue 2, Issue 3...
      const renumbered = updatedList.map((iss, index) => ({
        ...iss,
        issueNumber: index + 1,
      }));

      // Immediately update local UI
      setLocalIssues(renumbered);

      // Notify parent to save in storage & sync queue
      if (onReorderIssues) {
        onReorderIssues(renumbered);
      }
    },
    [localIssues, onReorderIssues]
  );

  // Touch handlers for mobile devices
  const handleTouchStart = (e: React.TouchEvent, index: number) => {
    touchActiveIndexRef.current = index;
    dragItemRef.current = index;
    setDraggedIndex(index);
    setDragOverIndex(index);
    isDraggingRef.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchActiveIndexRef.current === null) return;
    if (e.cancelable) {
      e.preventDefault();
    }
    const touch = e.touches[0];
    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    const row = elem?.closest('[data-issue-index]');
    if (row) {
      const targetIdx = parseInt(row.getAttribute('data-issue-index') || '-1', 10);
      if (targetIdx >= 0 && targetIdx < localIssues.length && targetIdx !== dragOverIndex) {
        setDragOverIndex(targetIdx);
      }
    }
  };

  const handleTouchEnd = () => {
    if (
      touchActiveIndexRef.current !== null &&
      dragOverIndex !== null &&
      touchActiveIndexRef.current !== dragOverIndex
    ) {
      moveIssueItem(touchActiveIndexRef.current, dragOverIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    touchActiveIndexRef.current = null;
    dragItemRef.current = null;
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 120);
  };

  // HTML5 Drag & Drop handlers for desktop
  const handleDragStart = (e: React.DragEvent, index: number) => {
    isDraggingRef.current = true;
    dragItemRef.current = index;
    setDraggedIndex(index);
    setDragOverIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    if (
      dragItemRef.current !== null &&
      dragOverIndex !== null &&
      dragItemRef.current !== dragOverIndex
    ) {
      moveIssueItem(dragItemRef.current, dragOverIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    dragItemRef.current = null;
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 120);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragItemRef.current !== null && dragItemRef.current !== index) {
      moveIssueItem(dragItemRef.current, index);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    dragItemRef.current = null;
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 120);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number, issueId: string) => {
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      if (index > 0) {
        moveIssueItem(index, index - 1);
      }
      return;
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      if (index < localIssues.length - 1) {
        moveIssueItem(index, index + 1);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenIssue(issueId);
    }
  };

  const issueCountLabel = useMemo(() => {
    if (localIssues.length === 0) return '0 issues';
    if (localIssues.length === 1) return '1 issue';
    return `${localIssues.length} issues`;
  }, [localIssues.length]);

  const handleSaveIssuesClick = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      if (onSaveIssues) {
        const result = await onSaveIssues();
        if (result === false) {
          setSaveError('Failed to save issues. Please try again.');
          setIsSaving(false);
          return;
        }
      }
      // After save succeeds, automatically navigate back to the associated Report Details page
      onBackToReport();
    } catch (err: any) {
      console.error('Error saving issues:', err);
      setSaveError(err?.message || 'Failed to save issues. Please try again.');
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto px-4 py-4 sm:px-6 sm:py-6 space-y-6 sm:space-y-7">
      {/* 1. Top Navigation Bar: ← Report Details */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#0E1E2B]/10">
        <button
          type="button"
          onClick={onBackToReport}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#0E1E2B]/15 bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] text-[#0E1E2B] font-mono font-bold text-xs uppercase tracking-wider touch-manipulation min-h-[44px] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30"
          aria-label="Return to report details"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
          <span>Report Details</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/50 hidden sm:inline-block">
            REPORT REF:
          </span>
          <span className="font-mono font-bold text-xs sm:text-sm text-[#0E1E2B] bg-white px-2.5 py-1 rounded-md border border-[#0E1E2B]/15 inline-block">
            {report.jobReference || 'BBC26-??'}
          </span>
        </div>
      </div>

      {/* 2. Header: ISSUES & Dynamic Count */}
      <header className="space-y-1">
        <div className="font-mono text-[11px] font-bold tracking-[0.2em] uppercase text-[#0E1E2B]/65 truncate">
          {report.reportName || report.jobReference || 'Inspection Report'}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-brand font-bold uppercase tracking-tight text-[#0E1E2B]">
            ISSUES
          </h1>
          {isNewReportWorkflow && (
            <span className="text-[10px] sm:text-[11px] font-mono font-bold tracking-wider uppercase text-[#0E1E2B] bg-[#B2E5F6]/40 border border-[#0E1E2B]/15 px-2.5 py-0.5 rounded shrink-0">
              Step 2 of inspection
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm font-mono font-semibold text-[#0E1E2B]/75">
          {issueCountLabel}
        </p>
      </header>

      {/* 3. Inspection Register: Draggable, Disciplined Register List */}
      <section aria-label="Inspection Issues Register" className="space-y-2">
        {localIssues.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#0E1E2B]/15 p-6 sm:p-8 text-center space-y-2">
            <p className="text-base font-bold text-[#0E1E2B]">
              No issues recorded
            </p>
          </div>
        ) : (
          <div
            className="bg-white rounded-xl border border-[#0E1E2B]/15 divide-y divide-[#0E1E2B]/10 overflow-hidden shadow-2xs select-none"
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            {localIssues.map((iss, index) => {
              const count = photoCounts[iss.id] || 0;
              const subtitle = formatIssueSubtitle(iss, count);
              const isDragged = draggedIndex === index;
              const isOver = dragOverIndex === index && draggedIndex !== null && draggedIndex !== index;

              return (
                <div
                  key={iss.id}
                  data-issue-index={index}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnter={(e) => handleDragEnter(e, index)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(e, index)}
                  onClick={() => {
                    if (isDraggingRef.current) return;
                    onOpenIssue(iss.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => handleKeyDown(e, index, iss.id)}
                  className={`group w-full p-3.5 sm:p-4.5 transition-all text-left block focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#628EF7] cursor-pointer touch-manipulation relative ${
                    isDragged
                      ? 'opacity-40 bg-[#F4F6F8] scale-[0.99] border-dashed border-[#628EF7]'
                      : isOver
                      ? 'bg-[#628EF7]/10 ring-2 ring-[#628EF7] ring-inset'
                      : 'hover:bg-[#F4F6F8]/80 active:bg-[#E5E8EB]'
                  }`}
                  aria-label={`Issue ${iss.issueNumber}: ${iss.issueName || 'Untitled Issue'}`}
                >
                  <div className="flex items-center justify-between gap-3 sm:gap-4">
                    {/* Visual Drag Handle: clearly indicates draggable register items */}
                    <div
                      className="drag-handle touch-none p-1.5 -ml-1 text-[#0E1E2B]/35 hover:text-[#0E1E2B]/80 active:text-[#628EF7] cursor-grab active:cursor-grabbing rounded transition-colors shrink-0 select-none flex items-center justify-center"
                      title="Drag to reorder"
                      aria-label={`Drag to reorder Issue ${iss.issueNumber}`}
                      onClick={(e) => e.stopPropagation()}
                      onTouchStart={(e) => handleTouchStart(e, index)}
                    >
                      <GripVertical className="w-5 h-5 stroke-[2.2]" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      {/* Sequential issue title: Issue 1, Issue 2, Issue 3... */}
                      <span className="font-mono font-bold text-xs sm:text-sm tracking-wider text-[#0E1E2B]/60 group-hover:text-[#628EF7] transition-colors block">
                        Issue {iss.issueNumber}
                      </span>

                      {/* Structural Foundation Crack */}
                      <h2 className="text-base sm:text-lg font-bold text-[#0E1E2B] group-hover:text-[#628EF7] transition-colors leading-snug tracking-tight">
                        {iss.issueName ? (
                          iss.issueName
                        ) : (
                          <span className="text-[#0E1E2B]/40 font-normal">
                            (Untitled Issue)
                          </span>
                        )}
                      </h2>

                      {/* Foundation · 3 evidence photos */}
                      <p className="text-xs sm:text-sm text-[#0E1E2B]/70 font-normal leading-relaxed">
                        {subtitle}
                      </p>
                    </div>

                    {/* Navigation indicator */}
                    <div className="flex items-center text-[#0E1E2B]/30 group-hover:text-[#628EF7] group-hover:translate-x-0.5 transition-all shrink-0">
                      <ChevronRight className="w-5 h-5 stroke-[2]" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Actions: [ + Add Issue ] then [ Save Issues ] */}
      <div className="space-y-3 pt-1">
        <button
          type="button"
          onClick={onAddIssue}
          className="w-full py-3.5 px-6 bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] text-[#0E1E2B] border border-[#0E1E2B]/20 font-bold text-sm tracking-wider uppercase rounded-lg flex items-center justify-center gap-2 transition-colors touch-manipulation min-h-[48px] sm:min-h-[52px] active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30 cursor-pointer shadow-2xs"
          aria-label="Add new issue"
        >
          <Plus className="w-4.5 h-4.5 stroke-[2.4]" />
          <span>Add Issue</span>
        </button>

        <button
          type="button"
          onClick={handleSaveIssuesClick}
          disabled={isSaving}
          className="w-full py-3.5 px-6 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] disabled:bg-[#628EF7]/70 text-white font-bold text-sm tracking-wider uppercase rounded-lg flex items-center justify-center gap-2 transition-colors touch-manipulation min-h-[48px] sm:min-h-[52px] active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-[#628EF7]/25 cursor-pointer shadow-xs"
          aria-label="Save issues"
        >
          {isSaving ? (
            <span>Saving Issues...</span>
          ) : (
            <>
              <Save className="w-4.5 h-4.5 stroke-[2.2]" />
              <span>Save Issues</span>
            </>
          )}
        </button>

        {saveError && (
          <div
            role="alert"
            className="p-3 bg-red-50 border border-red-200/80 rounded-lg text-red-900 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 stroke-[2.2] shrink-0" />
              <span>{saveError}</span>
            </div>
            <button
              type="button"
              onClick={handleSaveIssuesClick}
              className="text-red-700 underline hover:text-red-900 text-xs font-bold shrink-0 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
