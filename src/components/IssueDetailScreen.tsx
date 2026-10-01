import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Report, Issue, Photo, UploadTask } from '../types';
import { ConfirmationDialog } from './ConfirmationDialog';
import { generateId, savePhoto, getNextPhotoSequenceNumber, ensureSafeImageSize, comparePhotos, reorderPhotosForIssue } from '../db/storage';
import { extractExifCaptureDate } from '../utils/exifUtils';
import {
  ArrowLeft,
  Save,
  Trash2,
  Image as ImageIcon,
  Camera,
  Check,
  AlertCircle,
  RotateCw,
  UploadCloud,
  GripVertical,
} from 'lucide-react';

interface IssueDetailScreenProps {
  report: Report;
  issue: Issue;
  photos: Photo[];
  draft?: { issueName: string; issueDescription: string; notes: string };
  onDraftChange?: (draft: { issueName: string; issueDescription: string; notes: string }) => void;
  onBack: () => void;
  onSaveIssue: (updatedIssue: Issue) => Promise<boolean>;
  onDeleteIssue: (issueId: string) => Promise<boolean>;
  onOpenPhoto: (photoId: string) => void;
  onPhotosUpdated: () => void;
  onReorderPhotos?: (reorderedPhotos: Photo[]) => void | Promise<void>;
}

export const IssueDetailScreen: React.FC<IssueDetailScreenProps> = ({
  report,
  issue,
  photos,
  draft,
  onDraftChange,
  onBack,
  onSaveIssue,
  onDeleteIssue,
  onOpenPhoto,
  onPhotosUpdated,
  onReorderPhotos,
}) => {
  const [issueName, setIssueName] = useState(draft?.issueName ?? issue.issueName ?? '');
  const [issueDescription, setIssueDescription] = useState(draft?.issueDescription ?? issue.issueDescription ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? issue.notes ?? '');

  // Local working copy of photos for instant, responsive reordering feedback
  const [localPhotos, setLocalPhotos] = useState<Photo[]>(() => {
    return [...photos].sort(comparePhotos);
  });

  useEffect(() => {
    setLocalPhotos([...photos].sort(comparePhotos));
  }, [photos]);

  // Drag and drop state for photos
  const [draggedPhotoIndex, setDraggedPhotoIndex] = useState<number | null>(null);
  const [dragOverPhotoIndex, setDragOverPhotoIndex] = useState<number | null>(null);
  const isDraggingPhotoRef = useRef(false);
  const dragPhotoItemRef = useRef<number | null>(null);
  const touchActivePhotoIndexRef = useRef<number | null>(null);

  const movePhotoItem = useCallback(
    async (fromIdx: number, toIdx: number) => {
      if (
        fromIdx === toIdx ||
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= localPhotos.length ||
        toIdx >= localPhotos.length
      ) {
        return;
      }

      const updatedList = [...localPhotos];
      const [movedItem] = updatedList.splice(fromIdx, 1);
      updatedList.splice(toIdx, 0, movedItem);

      // Re-assign sequential sequence numbers: PHOTO 1, PHOTO 2, PHOTO 3...
      const renumbered = updatedList.map((photo, index) => ({
        ...photo,
        sequenceNumber: index + 1,
      }));

      // Immediately update local UI
      setLocalPhotos(renumbered);

      // Persist new sequence numbers to IndexedDB and sync queue
      try {
        if (onReorderPhotos) {
          await onReorderPhotos(renumbered);
        } else {
          await reorderPhotosForIssue(issue.id, renumbered.map(p => p.id));
          onPhotosUpdated();
        }
      } catch (err) {
        console.error('Failed to save reordered photos:', err);
        onPhotosUpdated();
      }
    },
    [localPhotos, issue.id, onReorderPhotos, onPhotosUpdated]
  );

  // Touch handlers for mobile devices
  const handlePhotoTouchStart = (e: React.TouchEvent, index: number) => {
    touchActivePhotoIndexRef.current = index;
    dragPhotoItemRef.current = index;
    setDraggedPhotoIndex(index);
    setDragOverPhotoIndex(index);
    isDraggingPhotoRef.current = true;
  };

  const handlePhotoTouchMove = (e: React.TouchEvent) => {
    if (touchActivePhotoIndexRef.current === null) return;
    if (e.cancelable) {
      e.preventDefault();
    }
    const touch = e.touches[0];
    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = elem?.closest('[data-photo-index]');
    if (card) {
      const targetIdx = parseInt(card.getAttribute('data-photo-index') || '-1', 10);
      if (targetIdx >= 0 && targetIdx < localPhotos.length && targetIdx !== dragOverPhotoIndex) {
        setDragOverPhotoIndex(targetIdx);
      }
    }
  };

  const handlePhotoTouchEnd = () => {
    if (
      touchActivePhotoIndexRef.current !== null &&
      dragOverPhotoIndex !== null &&
      touchActivePhotoIndexRef.current !== dragOverPhotoIndex
    ) {
      movePhotoItem(touchActivePhotoIndexRef.current, dragOverPhotoIndex);
    }
    setDraggedPhotoIndex(null);
    setDragOverPhotoIndex(null);
    touchActivePhotoIndexRef.current = null;
    dragPhotoItemRef.current = null;
    setTimeout(() => {
      isDraggingPhotoRef.current = false;
    }, 120);
  };

  // HTML5 Drag & Drop handlers for desktop
  const handlePhotoDragStart = (e: React.DragEvent, index: number) => {
    isDraggingPhotoRef.current = true;
    dragPhotoItemRef.current = index;
    setDraggedPhotoIndex(index);
    setDragOverPhotoIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handlePhotoDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPhotoIndex !== index) {
      setDragOverPhotoIndex(index);
    }
  };

  const handlePhotoDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverPhotoIndex(index);
  };

  const handlePhotoDragEnd = () => {
    if (
      dragPhotoItemRef.current !== null &&
      dragOverPhotoIndex !== null &&
      dragPhotoItemRef.current !== dragOverPhotoIndex
    ) {
      movePhotoItem(dragPhotoItemRef.current, dragOverPhotoIndex);
    }
    setDraggedPhotoIndex(null);
    setDragOverPhotoIndex(null);
    dragPhotoItemRef.current = null;
    setTimeout(() => {
      isDraggingPhotoRef.current = false;
    }, 120);
  };

  const handlePhotoDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragPhotoItemRef.current !== null && dragPhotoItemRef.current !== index) {
      movePhotoItem(dragPhotoItemRef.current, index);
    }
    setDraggedPhotoIndex(null);
    setDragOverPhotoIndex(null);
    dragPhotoItemRef.current = null;
    setTimeout(() => {
      isDraggingPhotoRef.current = false;
    }, 120);
  };

  const handlePhotoKeyDown = (e: React.KeyboardEvent, index: number, photoId: string) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      if (index > 0) {
        movePhotoItem(index, index - 1);
      }
      return;
    }
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
      e.preventDefault();
      if (index < localPhotos.length - 1) {
        movePhotoItem(index, index + 1);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpenPhotoItem(photoId);
    }
  };

  // Save states
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete states
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Native camera & multi-image upload task manager
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setIssueName(draft?.issueName ?? issue.issueName ?? '');
    setIssueDescription(draft?.issueDescription ?? issue.issueDescription ?? '');
    setNotes(draft?.notes ?? issue.notes ?? '');
  }, [issue.id, draft]);

  const handleNameChange = (val: string) => {
    setIssueName(val);
    onDraftChange?.({ issueName: val, issueDescription, notes });
  };

  const handleDescChange = (val: string) => {
    setIssueDescription(val);
    onDraftChange?.({ issueName, issueDescription: val, notes });
  };

  const handleNotesChange = (val: string) => {
    setNotes(val);
    onDraftChange?.({ issueName, issueDescription, notes: val });
  };

  const handleOpenPhotoItem = (photoId: string) => {
    if (isDraggingPhotoRef.current) return;
    onDraftChange?.({ issueName, issueDescription, notes });
    onOpenPhoto(photoId);
  };

  // Handle Save Issue information
  const handleSaveIssueInfo = async () => {
    if (isSaving) return;

    const trimmedName = issueName.trim();
    const trimmedDesc = issueDescription.trim();
    const trimmedNotes = notes.trim();

    // Meaningful content rule: require at least title/name, description, notes, or evidence photos
    const hasMeaningfulContent =
      trimmedName !== '' ||
      trimmedDesc !== '' ||
      trimmedNotes !== '' ||
      localPhotos.length > 0 ||
      uploadTasks.length > 0;

    if (!hasMeaningfulContent) {
      setSaveError('Please enter an issue title, description, or add evidence to save this issue.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const updated: Issue = {
        ...issue,
        issueName: trimmedName,
        issueDescription: trimmedDesc,
        notes: trimmedNotes,
      };
      const ok = await onSaveIssue(updated);
      if (ok) {
        setSaveSuccess(true);
        // Automatically navigate back to associated report detail page upon saving
        onBack();
      } else {
        setSaveError('Failed to save issue details. Please retry.');
      }
    } catch (err: any) {
      setSaveError(err.message || 'Error occurred while saving issue.');
    } finally {
      setIsSaving(false);
    }
  };

  // Convert File to data URL
  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  // Process and upload a single file with tracking and denormalized fields
  const processImageUpload = async (
    file: File,
    taskId: string,
    explicitSequence?: number,
    explicitCreatedAt?: string
  ) => {
    try {
      // Step 1: Upload progress simulation + read file
      setUploadTasks(prev =>
        prev.map(t => (t.id === taskId ? { ...t, progress: 20, state: 'uploading' } : t))
      );

      // Extract original capture timestamp from EXIF DateTimeOriginal, falling back to file lastModified or current time
      const exifDate = await extractExifCaptureDate(file);
      const capturedAt = exifDate || (file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString());

      const dataUrl = await readFileAsDataUrl(file);
      // Intelligently compress image (2000-2500px max edge, ~80% quality JPEG, preserving orientation)
      const compressedDataUrl = await ensureSafeImageSize(dataUrl);

      setUploadTasks(prev =>
        prev.map(t => (t.id === taskId ? { ...t, progress: 70, state: 'uploading' } : t))
      );

      // Determine sequence number - append after existing photos
      const sequenceNumber = explicitSequence !== undefined
        ? explicitSequence
        : await getNextPhotoSequenceNumber(issue.id);

      const photoId = generateId();
      const storageUri = `gs://assured-capture-storage/reports/${report.jobReference}/issue_${issue.issueNumber}/${photoId}.jpg`;
      const now = explicitCreatedAt || new Date().toISOString();

      const newPhoto: Photo = {
        id: photoId,
        issueId: issue.id,
        reportId: report.id,
        imageFile: compressedDataUrl,
        originalImageFile: compressedDataUrl,
        storageUri,
        description: '',
        internalNotes: '',
        includeInReport: true,
        isReferenceImage: false,
        issueNumber: issue.issueNumber,
        jobReference: report.jobReference,
        sequenceNumber,
        capturedAt: capturedAt || null,
        createdAt: now,
        updatedAt: now,
      };

      // Ensure parent issue is saved before attaching photo evidence
      await onSaveIssue({
        ...issue,
        issueName: issueName.trim(),
        issueDescription: issueDescription.trim(),
        notes: notes.trim(),
      });

      // Persist to storage
      await savePhoto(newPhoto);

      // Mark complete
      setUploadTasks(prev =>
        prev.map(t =>
          t.id === taskId
            ? { ...t, progress: 100, state: 'complete', photoId }
            : t
        )
      );

      // Notify parent to refresh photo list
      onPhotosUpdated();
    } catch (err: any) {
      console.error('Photo upload failed:', err);
      setUploadTasks(prev =>
        prev.map(t =>
          t.id === taskId
            ? {
                ...t,
                state: 'failed',
                errorMessage: err.message || 'Storage write failed',
              }
            : t
        )
      );
    }
  };

  // Handle Gallery Selection (Multi-image upload)
  const handleGallerySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    // Reset input so same images can be re-selected if needed
    e.target.value = '';

    // Create tasks for every selected image
    const newTasks: UploadTask[] = fileList.map(f => {
      const taskId = generateId();
      const previewUrl = URL.createObjectURL(f);
      return {
        id: taskId,
        fileName: f.name,
        fileSize: f.size,
        previewUrl,
        progress: 10,
        state: 'uploading',
      };
    });

    setUploadTasks(prev => [...newTasks, ...prev]);

    // Calculate base sequence number so multiple photos are appended in selection order
    const startSeq = await getNextPhotoSequenceNumber(issue.id);
    const baseTime = Date.now();

    // Process all images in sequence to guarantee append order
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const task = newTasks[i];
      const plannedSeq = startSeq + i;
      const plannedCreatedAt = new Date(baseTime + (i * 20)).toISOString();
      await processImageUpload(file, task.id, plannedSeq, plannedCreatedAt);
    }
  };

  // Handle Camera Capture single photo
  const handleCameraPhoto = async (file: File) => {
    const taskId = generateId();
    const previewUrl = URL.createObjectURL(file);
    const newTask: UploadTask = {
      id: taskId,
      fileName: file.name || 'field_camera_photo.jpg',
      fileSize: file.size,
      previewUrl,
      progress: 10,
      state: 'uploading',
    };

    setUploadTasks(prev => [newTask, ...prev]);
    const nextSeq = await getNextPhotoSequenceNumber(issue.id);
    await processImageUpload(file, taskId, nextSeq);
  };

  // Handle native camera capture input change
  const handleCameraInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await handleCameraPhoto(file);
    } finally {
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }
    }
  };

  // Retry failed upload
  const handleRetryUpload = (task: UploadTask) => {
    // If previewUrl is available, fetch blob and retry
    fetch(task.previewUrl)
      .then(res => res.blob())
      .then(async blob => {
        const file = new File([blob], task.fileName, { type: blob.type || 'image/jpeg' });
        const nextSeq = await getNextPhotoSequenceNumber(issue.id);
        processImageUpload(file, task.id, nextSeq);
      })
      .catch(err => {
        console.error('Cannot retry from blob:', err);
      });
  };

  // Handle Delete Issue
  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const ok = await onDeleteIssue(issue.id);
      if (!ok) {
        setDeleteError('Failed to delete issue. Please try again.');
        setIsDeleting(false);
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Error occurred while deleting issue.');
      setIsDeleting(false);
    }
  };

  const inProgressUploads = uploadTasks.filter(t => t.state === 'uploading');
  const failedUploads = uploadTasks.filter(t => t.state === 'failed');

  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto px-4 py-4 sm:px-6 sm:py-6 space-y-6 sm:space-y-8">
      {/* Navigation Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#0E1E2B]/10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#0E1E2B]/15 bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] text-[#0E1E2B] font-mono font-bold text-xs uppercase tracking-wider touch-manipulation min-h-[44px] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30"
          aria-label="Return to issues register"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
          <span>ISSUES</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/50 hidden sm:inline-block">
            REPORT REF:
          </span>
          <span className="font-mono font-bold text-xs sm:text-sm text-[#0E1E2B] bg-white px-2.5 py-1 rounded-md border border-[#0E1E2B]/15 inline-block">
            {report.jobReference}
          </span>
        </div>
      </div>

      {/* TOP BRANDED ISSUE IDENTITY BLOCK (SKY CYAN SURFACE) */}
      <header className="w-full bg-[#B2E5F6] border border-[#0E1E2B]/15 rounded-xl p-4 sm:p-5 space-y-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-[11px] uppercase tracking-[0.2em] text-[#0E1E2B]/70">
              ISSUE #{String(issue.issueNumber).padStart(2, '0')}
            </span>
            <span className="text-[#0E1E2B]/30 font-mono text-xs">·</span>
            <span className="font-mono font-semibold text-xs text-[#0E1E2B]/75">
              {report.jobReference}
            </span>
          </div>

          {/* Issue title: prominent, allows wrapping naturally to a maximum of 2 lines */}
          <h1
            title={issueName || 'Untitled Defect'}
            className="text-xl sm:text-2xl font-brand font-bold text-[#0E1E2B] tracking-tight leading-snug break-normal line-clamp-2 pt-0.5"
          >
            {issueName || <span className="text-[#0E1E2B]/40 font-normal font-sans text-lg">(Untitled Issue)</span>}
          </h1>
        </div>

        <div className="pt-2.5 border-t border-[#0E1E2B]/15 flex items-center justify-between text-xs text-[#0E1E2B]">
          <span className="text-[#0E1E2B]/70 truncate max-w-[65%] sm:max-w-[75%] font-medium">
            {report.reportName || 'Inspection Record'}
          </span>
          <span className="font-mono font-bold text-[11px] bg-white px-2.5 py-0.5 rounded border border-[#0E1E2B]/15 shrink-0">
            {photos.length} {photos.length === 1 ? 'Evidence Photo' : 'Evidence Photos'}
          </span>
        </div>
      </header>

      {/* SECTION 1: ISSUE INFORMATION */}
      <section className="space-y-4 pt-1">
        <div className="border-b border-[#0E1E2B]/10 pb-2">
          <h2 className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#0E1E2B]">
            ISSUE INFORMATION
          </h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
              Issue Name <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              value={issueName}
              onChange={e => handleNameChange(e.target.value)}
              className="w-full text-sm sm:text-base font-medium px-3.5 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] sm:min-h-[48px]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
              Issue Description (Formal Report Narrative)
            </label>
            <textarea
              value={issueDescription}
              onChange={e => handleDescChange(e.target.value)}
              rows={4}
              className="w-full text-sm sm:text-base font-normal px-3.5 py-2.5 sm:py-3 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[110px] leading-relaxed"
            />
          </div>
        </div>
      </section>

      {/* SECTION 2: PHOTOGRAPHIC EVIDENCE (VISUAL FOCUS OF THE PAGE) */}
      <section className="space-y-4 pt-1">
        <div className="border-b border-[#0E1E2B]/10 pb-2 flex items-center justify-between">
          <div>
            <h2 className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#0E1E2B]">
              PHOTOGRAPHIC EVIDENCE
            </h2>
          </div>
          <span className="font-mono text-xs font-bold text-[#0E1E2B] bg-white px-2.5 py-1 rounded border border-[#0E1E2B]/15">
            {photos.length} {photos.length === 1 ? 'Photo' : 'Photos'}
          </span>
        </div>

        {/* Action Controls: Take Field Photo & Choose From Gallery as primary evidence actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="w-full py-3.5 px-5 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[48px] flex items-center justify-center gap-2 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white shadow-sm transition-colors touch-manipulation active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-[#628EF7]/25 cursor-pointer"
            aria-label="Take inspection photo using camera"
          >
            <Camera className="w-4.5 h-4.5 stroke-[2.2]" />
            <span>Take Field Photo</span>
          </button>

          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="w-full py-3.5 px-5 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[48px] flex items-center justify-center gap-2 bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] text-[#0E1E2B] border border-[#0E1E2B]/20 hover:border-[#0E1E2B] transition-colors touch-manipulation active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30 cursor-pointer"
            aria-label="Choose multiple photos from gallery"
          >
            <ImageIcon className="w-4 h-4 stroke-[2.2] text-[#0E1E2B]" />
            <span>Choose From Gallery</span>
          </button>

          {/* Hidden native camera capture input */}
          <input
            type="file"
            ref={cameraInputRef}
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleCameraInputChange}
          />

          {/* Hidden multi-file gallery input */}
          <input
            type="file"
            ref={galleryInputRef}
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleGallerySelect}
          />
        </div>

        {/* Multi-image upload progress tracker */}
        {(inProgressUploads.length > 0 || failedUploads.length > 0) && (
          <div className="bg-white rounded-lg border border-[#061D24]/15 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#061D24] font-bold text-xs uppercase tracking-wider">
                <UploadCloud className="w-4 h-4 text-[#5788F5]" />
                <span>
                  Upload Status ({inProgressUploads.length} uploading, {failedUploads.length} failed)
                </span>
              </div>
              {inProgressUploads.length > 0 && (
                <span className="text-xs font-semibold text-[#5788F5] animate-pulse">
                  Saving to Storage...
                </span>
              )}
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {uploadTasks
                .filter(t => t.state !== 'complete')
                .map(task => (
                  <div
                    key={task.id}
                    className="p-3 bg-[#F4F5F6] border border-[#061D24]/15 rounded flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={task.previewUrl}
                        alt={task.fileName}
                        className="w-9 h-9 rounded object-cover border border-[#061D24]/15 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-[#061D24] truncate">{task.fileName}</p>
                        <p className="text-[#061D24]/60">
                          {task.state === 'uploading'
                            ? `Uploading (${task.progress}%)...`
                            : `Failed: ${task.errorMessage || 'Storage error'}`}
                        </p>
                      </div>
                    </div>

                    <div>
                      {task.state === 'uploading' ? (
                        <div className="w-4 h-4 border-2 border-[#061D24]/20 border-t-[#5788F5] rounded-full animate-spin" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRetryUpload(task)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 text-white font-semibold rounded hover:bg-rose-700 min-h-[32px] cursor-pointer"
                        >
                          <RotateCw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Photographic Evidence Gallery: Compact square thumbnails focused on visual identification */}
        {localPhotos.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#0E1E2B]/15 p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#F4F6F8] text-[#0E1E2B]/40 flex items-center justify-center mx-auto mb-2.5 border border-[#0E1E2B]/10">
              <Camera className="w-5 h-5 stroke-[1.8]" />
            </div>
            <p className="text-sm font-bold text-[#0E1E2B]">No photographic evidence captured</p>
          </div>
        ) : (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3.5 select-none"
            onTouchMove={handlePhotoTouchMove}
            onTouchEnd={handlePhotoTouchEnd}
            onTouchCancel={handlePhotoTouchEnd}
          >
            {localPhotos.map((photo, idx) => {
              const photoNum = idx + 1;
              const isDragged = draggedPhotoIndex === idx;
              const isOver = dragOverPhotoIndex === idx && draggedPhotoIndex !== null && draggedPhotoIndex !== idx;

              return (
                <div
                  key={photo.id}
                  data-photo-index={idx}
                  draggable={true}
                  onDragStart={(e) => handlePhotoDragStart(e, idx)}
                  onDragOver={(e) => handlePhotoDragOver(e, idx)}
                  onDragEnter={(e) => handlePhotoDragEnter(e, idx)}
                  onDragEnd={handlePhotoDragEnd}
                  onDrop={(e) => handlePhotoDrop(e, idx)}
                  onKeyDown={(e) => handlePhotoKeyDown(e, idx, photo.id)}
                  tabIndex={0}
                  onClick={() => handleOpenPhotoItem(photo.id)}
                  role="button"
                  aria-label={`Photo ${photoNum}, tap to open details`}
                  className={`group relative aspect-square bg-[#0E1E2B]/5 rounded-xl border border-[#0E1E2B]/15 overflow-hidden cursor-pointer shadow-2xs transition-all focus:outline-none focus:ring-2 focus:ring-[#628EF7] ${
                    isDragged
                      ? 'opacity-35 scale-95 border-2 border-dashed border-[#628EF7]'
                      : isOver
                      ? 'ring-3 ring-[#628EF7] ring-inset scale-[1.02]'
                      : 'hover:border-[#0E1E2B]/40 hover:shadow-sm active:scale-[0.98]'
                  }`}
                >
                  {/* Photo image cleanly filling the square container without distortion */}
                  <img
                    src={photo.imageFile}
                    alt={photo.description || `Photo ${photoNum}`}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105 pointer-events-none"
                    loading="lazy"
                  />

                  {/* Subtle top gradient for high contrast readability of overlay controls */}
                  <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#0E1E2B]/60 via-[#0E1E2B]/20 to-transparent pointer-events-none" />

                  {/* Photo sequence badge: subtle, clear identification of order */}
                  <div className="absolute top-2 left-2 z-10 pointer-events-none">
                    <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md bg-[#0E1E2B]/80 text-white font-mono font-bold text-[10px] sm:text-[11px] uppercase tracking-wider backdrop-blur-xs shadow-xs border border-white/15">
                      Photo {photoNum}
                    </span>
                  </div>

                  {/* Drag handle: unobtrusive, clearly draggable on mouse and touch */}
                  <div
                    className="drag-handle absolute top-2 right-2 z-10 touch-none p-1 rounded-md bg-[#0E1E2B]/75 hover:bg-[#0E1E2B] text-white/90 hover:text-white backdrop-blur-xs shadow-xs border border-white/15 cursor-grab active:cursor-grabbing transition-colors"
                    title={`Drag to reorder Photo ${photoNum}`}
                    aria-label={`Drag to reorder Photo ${photoNum}`}
                    onClick={(e) => e.stopPropagation()}
                    onTouchStart={(e) => handlePhotoTouchStart(e, idx)}
                  >
                    <GripVertical className="w-3.5 h-3.5 stroke-[2.2]" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 3: PRIMARY ACTION - SAVE ISSUE */}
      <div className="pt-2 space-y-2">
        <button
          type="button"
          onClick={handleSaveIssueInfo}
          disabled={isSaving}
          className={`w-full py-3.5 px-6 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[48px] sm:min-h-[52px] flex items-center justify-center gap-2.5 transition-colors touch-manipulation active:scale-[0.99] cursor-pointer shadow-sm ${
            saveSuccess
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white focus:ring-4 focus:ring-[#628EF7]/25'
          } ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {isSaving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Saving Issue...</span>
            </>
          ) : saveSuccess ? (
            <>
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Issue Saved</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4 stroke-[2.2]" />
              <span>SAVE ISSUE</span>
            </>
          )}
        </button>

        {saveError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}
      </div>

      {/* DESTRUCTIVE ACTION: Clearly separated below with lower visual emphasis */}
      <div className="pt-6 sm:pt-8 border-t border-[#0E1E2B]/10">
        <button
          type="button"
          onClick={() => setIsDeleteDialogOpen(true)}
          className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-rose-50/60 active:bg-rose-100/60 border border-[#0E1E2B]/15 hover:border-rose-300 text-[#0E1E2B]/70 hover:text-rose-700 font-semibold text-xs min-h-[44px] transition-colors touch-manipulation cursor-pointer flex items-center justify-center gap-2"
        >
          <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
          <span>Delete Issue</span>
        </button>

        {deleteError && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs font-semibold">
            {deleteError}
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Delete Issue */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        title="Delete Issue"
        message="Delete this issue?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsDeleteDialogOpen(false)}
      />
    </div>
  );
};
