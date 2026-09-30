import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Report, Issue, Photo, TextBoxAnnotation } from '../types';
import { ConfirmationDialog } from './ConfirmationDialog';
import { VoiceTranscriptionControl } from './VoiceTranscriptionControl';
import {
  ArrowLeft,
  Save,
  Trash2,
  Check,
  AlertCircle,
  PenTool,
  RotateCcw,
  CheckCheck,
  X,
  Camera,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Type,
  Clock,
  Calendar,
} from 'lucide-react';
import { formatCaptureDateTime, extractExifCaptureDate } from '../utils/exifUtils';

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const rawParagraphs = text.split(/\r?\n/);

  for (const paragraph of rawParagraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        // If single word itself exceeds maxWidth, break the word into character chunks
        if (ctx.measureText(word).width > maxWidth) {
          let subWord = '';
          for (const char of word) {
            if (ctx.measureText(subWord + char).width > maxWidth) {
              if (subWord) lines.push(subWord);
              subWord = char;
            } else {
              subWord += char;
            }
          }
          currentLine = subWord;
        } else {
          currentLine = word;
        }
      } else if (metrics.width > maxWidth && !currentLine) {
        let subWord = '';
        for (const char of word) {
          if (ctx.measureText(subWord + char).width > maxWidth) {
            if (subWord) lines.push(subWord);
            subWord = char;
          } else {
            subWord += char;
          }
        }
        currentLine = subWord;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

function drawTextBoxOnCanvas(
  ctx: CanvasRenderingContext2D,
  box: TextBoxAnnotation,
  canvasWidth: number,
  canvasHeight: number,
  displayedWidth?: number
) {
  if (!box.text || !box.text.trim()) return;

  const x = (box.x / 100) * canvasWidth;
  const y = (box.y / 100) * canvasHeight;

  const boxScale = box.scale || 1.0;
  // Convert editor displayed CSS dimensions to actual canvas resolution coordinates
  const dispW = displayedWidth && displayedWidth > 50 ? displayedWidth : 500;
  const scaleMultiplier = canvasWidth / dispW;

  // Editor base font is 14px * boxScale; convert to exact canvas pixel font size
  const editorFontSize = 14 * boxScale;
  const fontSize = Math.max(8, Math.round(editorFontSize * scaleMultiplier));
  const paddingX = Math.round(8 * boxScale * scaleMultiplier);
  const paddingY = Math.round(4 * boxScale * scaleMultiplier);
  const borderRadius = Math.max(4, Math.round(6 * boxScale * scaleMultiplier));
  const lineHeight = Math.round(fontSize * 1.35);

  ctx.save();
  ctx.font = `bold ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.textBaseline = 'top';

  const maxTextWidth = Math.max(100 * scaleMultiplier, canvasWidth * 0.92 - paddingX * 2);
  const lines = wrapText(ctx, box.text.trim(), maxTextWidth);

  // Measure widest line to determine exact dynamic box width
  let maxLineWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) {
      maxLineWidth = w;
    }
  }

  const boxWidth = maxLineWidth + paddingX * 2;
  const boxHeight = lines.length * lineHeight + paddingY * 2;

  // Keep within canvas bounds without jumping
  const clampedX = Math.max(4, Math.min(canvasWidth - boxWidth - 4, x));
  const clampedY = Math.max(4, Math.min(canvasHeight - boxHeight - 4, y));

  const color = box.color || '#EF4444';

  // 1. Text Box Outline with COMPLETELY TRANSPARENT background (no filled rectangle)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = Math.max(2, Math.round(fontSize * 0.25));
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, Math.round(2 * boxScale * scaleMultiplier));

  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(clampedX, clampedY, boxWidth, boxHeight, borderRadius);
  } else {
    ctx.rect(clampedX, clampedY, boxWidth, boxHeight);
  }
  // No fill - transparent background
  ctx.stroke();

  // 2. Text rendered line-by-line in the selected markup color
  ctx.fillStyle = color;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], clampedX + paddingX, clampedY + paddingY + i * lineHeight);
  }
  ctx.restore();
}

interface PhotoDetailScreenProps {
  report: Report;
  issue: Issue;
  photo: Photo;
  photos?: Photo[];
  issues?: Issue[];
  onBack: () => void;
  onSelectPhoto?: (photoId: string) => void;
  onSavePhoto: (updatedPhoto: Photo) => Promise<boolean>;
  onDeletePhoto: (photoId: string) => Promise<boolean>;
}

export const PhotoDetailScreen: React.FC<PhotoDetailScreenProps> = ({
  report,
  issue,
  photo,
  photos = [],
  issues = [],
  onBack,
  onSelectPhoto,
  onSavePhoto,
  onDeletePhoto,
}) => {
  const [description, setDescription] = useState(photo.description || '');
  const [internalNotes, setInternalNotes] = useState(photo.internalNotes || '');
  const [includeInReport, setIncludeInReport] = useState<boolean>(photo.includeInReport !== false);
  const [selectedIssueId, setSelectedIssueId] = useState(photo.issueId || issue.id);
  const [currentImageFile, setCurrentImageFile] = useState(photo.imageFile);

  // Drawing / Markup mode states
  const [isMarkupActive, setIsMarkupActive] = useState(false);
  const [markupColor, setMarkupColor] = useState('#EF4444'); // Signal red default for defects
  const [markupTool, setMarkupTool] = useState<'pen' | 'arrow' | 'rect' | 'text'>('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [canvasHistory, setCanvasHistory] = useState<ImageData[]>([]);

  // Text Box Annotation states
  const [baseImageFile, setBaseImageFile] = useState<string>(photo.originalImageFile || photo.imageFile);
  const [textBoxes, setTextBoxes] = useState<TextBoxAnnotation[]>(photo.textBoxAnnotations || []);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [draggingTextBoxId, setDraggingTextBoxId] = useState<string | null>(null);
  const dragStartPosRef = useRef<{ clientX: number; clientY: number; boxX: number; boxY: number } | null>(null);

  // Text Box manual resizing states
  const [resizingTextBoxId, setResizingTextBoxId] = useState<string | null>(null);
  const dragResizeStartRef = useRef<{
    clientX: number;
    clientY: number;
    initialScale: number;
    originX: number;
    originY: number;
    startHypot: number;
  } | null>(null);

  // Original capture timestamp state (EXIF DateTimeOriginal)
  const [capturedAt, setCapturedAt] = useState<string | null | undefined>(photo.capturedAt);

  // Technical details disclosure state (hidden by default on mobile)
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // Save states
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete states
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Photo Description 250-character recommended limit tracking & overflow backdrop
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionBackdropRef = useRef<HTMLDivElement | null>(null);
  const [descriptionScrollbarOffset, setDescriptionScrollbarOffset] = useState<number>(0);

  const descChars = Array.from(description);
  const descCharCount = descChars.length;
  const isDescOverLimit = descCharCount > 250;
  const descOverflowCount = Math.max(0, descCharCount - 250);

  const descValidText = descChars.slice(0, 250).join('');
  const descOverflowText = descChars.slice(250).join('');

  const syncDescriptionScroll = useCallback(() => {
    if (descriptionTextareaRef.current && descriptionBackdropRef.current) {
      descriptionBackdropRef.current.scrollTop = descriptionTextareaRef.current.scrollTop;
      descriptionBackdropRef.current.scrollLeft = descriptionTextareaRef.current.scrollLeft;

      const sbWidth = descriptionTextareaRef.current.offsetWidth - descriptionTextareaRef.current.clientWidth - 2;
      const effectiveSb = Math.max(0, sbWidth);
      if (effectiveSb !== descriptionScrollbarOffset) {
        setDescriptionScrollbarOffset(effectiveSb);
      }
    }
  }, [descriptionScrollbarOffset]);

  useEffect(() => {
    syncDescriptionScroll();
  }, [description, syncDescriptionScroll]);

  useEffect(() => {
    setDescription(photo.description || '');
    setInternalNotes(photo.internalNotes || '');
    setIncludeInReport(photo.includeInReport !== false);
    setSelectedIssueId(photo.issueId || issue.id);
    setCurrentImageFile(photo.imageFile);
    setBaseImageFile(photo.originalImageFile || photo.imageFile);
    setTextBoxes(photo.textBoxAnnotations || []);
    setSelectedTextBoxId(null);

    // Prefer stored capturedAt; if unset/undefined, attempt lazy extraction from image once
    if (photo.capturedAt !== undefined) {
      setCapturedAt(photo.capturedAt);
    } else {
      let active = true;
      extractExifCaptureDate(photo.originalImageFile || photo.imageFile)
        .then(extracted => {
          if (active) setCapturedAt(extracted);
        })
        .catch(() => {
          if (active) setCapturedAt(null);
        });
      return () => {
        active = false;
      };
    }
  }, [photo, issue]);

  // Color change updates selected text box color in addition to markupColor
  const handleColorChange = (newColor: string) => {
    setMarkupColor(newColor);
    if (selectedTextBoxId) {
      setTextBoxes(prev =>
        prev.map(b => (b.id === selectedTextBoxId ? { ...b, color: newColor } : b))
      );
    }
  };

  // Text box pointer down for dragging/moving
  const handleTextBoxPointerDown = (e: React.MouseEvent | React.TouchEvent, boxId: string) => {
    e.stopPropagation();
    setSelectedTextBoxId(boxId);
    setDraggingTextBoxId(boxId);

    const targetBox = textBoxes.find(b => b.id === boxId);
    if (!targetBox) return;

    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    dragStartPosRef.current = {
      clientX,
      clientY,
      boxX: targetBox.x,
      boxY: targetBox.y,
    };
  };

  // Dragging text box move handler
  const handleTextBoxPointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!draggingTextBoxId || !dragStartPosRef.current || !imageContainerRef.current) return;

    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    }

    const containerRect = imageContainerRef.current.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) return;

    const deltaXPercent = ((clientX - dragStartPosRef.current.clientX) / containerRect.width) * 100;
    const deltaYPercent = ((clientY - dragStartPosRef.current.clientY) / containerRect.height) * 100;

    const newX = Math.max(0.5, Math.min(88, dragStartPosRef.current.boxX + deltaXPercent));
    const newY = Math.max(0.5, Math.min(92, dragStartPosRef.current.boxY + deltaYPercent));

    setTextBoxes(prev =>
      prev.map(b => (b.id === draggingTextBoxId ? { ...b, x: Math.round(newX * 10) / 10, y: Math.round(newY * 10) / 10 } : b))
    );
  }, [draggingTextBoxId]);

  const handleTextBoxPointerUp = useCallback(() => {
    if (draggingTextBoxId) {
      setDraggingTextBoxId(null);
      dragStartPosRef.current = null;
    }
  }, [draggingTextBoxId]);

  useEffect(() => {
    if (draggingTextBoxId) {
      const onMove = (e: MouseEvent | TouchEvent) => handleTextBoxPointerMove(e);
      const onUp = () => handleTextBoxPointerUp();

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
      window.addEventListener('touchcancel', onUp);

      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('touchcancel', onUp);
      };
    }
  }, [draggingTextBoxId, handleTextBoxPointerMove, handleTextBoxPointerUp]);

  // Text box pointer down on corner resize handle
  const handleTextBoxResizePointerDown = (e: React.MouseEvent | React.TouchEvent, boxId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedTextBoxId(boxId);
    setResizingTextBoxId(boxId);

    const targetBox = textBoxes.find(b => b.id === boxId);
    if (!targetBox) return;

    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const boxElem = document.getElementById(`markup_textbox_${boxId}`);
    const boxRect = boxElem ? boxElem.getBoundingClientRect() : null;
    const originX = boxRect ? boxRect.left : clientX - 80;
    const originY = boxRect ? boxRect.top : clientY - 30;

    const startHypot = Math.max(20, Math.hypot(clientX - originX, clientY - originY));

    dragResizeStartRef.current = {
      clientX,
      clientY,
      initialScale: targetBox.scale || 1.0,
      originX,
      originY,
      startHypot,
    };
  };

  // Text box resize dragging move handler
  const handleTextBoxResizePointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!resizingTextBoxId || !dragResizeStartRef.current) return;

    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    }

    const { initialScale, originX, originY, startHypot } = dragResizeStartRef.current;
    const currentHypot = Math.hypot(clientX - originX, clientY - originY);
    const ratio = currentHypot / startHypot;
    const newScale = Math.min(3.5, Math.max(0.5, Math.round(initialScale * ratio * 100) / 100));

    setTextBoxes(prev =>
      prev.map(b => (b.id === resizingTextBoxId ? { ...b, scale: newScale } : b))
    );
  }, [resizingTextBoxId]);

  const handleTextBoxResizePointerUp = useCallback(() => {
    if (resizingTextBoxId) {
      setResizingTextBoxId(null);
      dragResizeStartRef.current = null;
    }
  }, [resizingTextBoxId]);

  useEffect(() => {
    if (resizingTextBoxId) {
      const onMove = (e: MouseEvent | TouchEvent) => handleTextBoxResizePointerMove(e);
      const onUp = () => handleTextBoxResizePointerUp();

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
      window.addEventListener('touchcancel', onUp);

      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('touchcancel', onUp);
      };
    }
  }, [resizingTextBoxId, handleTextBoxResizePointerMove, handleTextBoxResizePointerUp]);

  const handleUpdateTextBoxText = (id: string, text: string) => {
    setTextBoxes(prev => prev.map(b => (b.id === id ? { ...b, text } : b)));
  };

  const handleDeleteTextBox = (id: string) => {
    setTextBoxes(prev => prev.filter(b => b.id !== id));
    if (selectedTextBoxId === id) {
      setSelectedTextBoxId(null);
    }
  };

  // Voice transcript reception
  const handleTranscriptReceived = (transcript: string) => {
    if (!transcript) return;
    setDescription(prev => {
      const trimmed = prev.trim();
      if (!trimmed) {
        return transcript;
      }
      return `${trimmed}. ${transcript}`;
    });
  };

  // Setup Canvas when entering Markup Mode
  useEffect(() => {
    if (isMarkupActive && canvasRef.current && imageRef.current) {
      const canvas = canvasRef.current;
      const img = imageRef.current;
      canvas.width = img.naturalWidth || img.clientWidth;
      canvas.height = img.naturalHeight || img.clientHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Save initial blank state
        setCanvasHistory([ctx.getImageData(0, 0, canvas.width, canvas.height)]);
      }
    }
  }, [isMarkupActive]);

  // Canvas drawing handlers
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return lastPosRef.current || startPos || { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;

    let clientX: number | undefined;
    let clientY: number | undefined;

    // In touch events, active touches are in e.touches, but on touchend e.touches is empty
    // and the ended touch is in e.changedTouches.
    if ('touches' in e && e.touches && e.touches.length > 0 && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('changedTouches' in e && e.changedTouches && e.changedTouches.length > 0 && e.changedTouches[0]) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else if ('clientX' in e && typeof (e as React.MouseEvent<HTMLCanvasElement>).clientX === 'number') {
      clientX = (e as React.MouseEvent<HTMLCanvasElement>).clientX;
      clientY = (e as React.MouseEvent<HTMLCanvasElement>).clientY;
    }

    if (clientX === undefined || clientY === undefined) {
      return lastPosRef.current || startPos || { x: 0, y: 0 };
    }

    const pos = {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
    lastPosRef.current = pos;
    return pos;
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isMarkupActive) return;

    if (markupTool === 'text') {
      const container = imageContainerRef.current || canvasRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      let clientX: number | undefined;
      let clientY: number | undefined;
      if ('touches' in e && e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
      }

      if (clientX === undefined || clientY === undefined) return;

      const xPercent = Math.max(2, Math.min(80, ((clientX - rect.left) / rect.width) * 100));
      const yPercent = Math.max(2, Math.min(85, ((clientY - rect.top) / rect.height) * 100));

      const newId = `tb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newBox: TextBoxAnnotation = {
        id: newId,
        text: '',
        x: Math.round(xPercent * 10) / 10,
        y: Math.round(yPercent * 10) / 10,
        color: markupColor,
        scale: 1.0,
      };

      setTextBoxes(prev => [...prev, newBox]);
      setSelectedTextBoxId(newId);
      return;
    }

    const coords = getCanvasCoordinates(e);
    setIsDrawing(true);
    setStartPos(coords);
    lastPosRef.current = coords;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (markupTool === 'pen') {
      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
      ctx.strokeStyle = markupColor;
      ctx.lineWidth = Math.max(4, Math.round(canvas.width / 200));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isMarkupActive || !startPos) return;
    const coords = getCanvasCoordinates(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (markupTool === 'pen') {
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    } else if (canvasHistory.length > 0) {
      // Live preview for shape tools: restore snapshot before drawing preview
      const last = canvasHistory[canvasHistory.length - 1];
      ctx.putImageData(last, 0, 0);

      if (markupTool === 'rect') {
        ctx.strokeStyle = markupColor;
        ctx.lineWidth = Math.max(4, Math.round(canvas.width / 200));
        ctx.strokeRect(startPos.x, startPos.y, coords.x - startPos.x, coords.y - startPos.y);
      } else if (markupTool === 'arrow') {
        ctx.strokeStyle = markupColor;
        ctx.fillStyle = markupColor;
        ctx.lineWidth = Math.max(4, Math.round(canvas.width / 200));
        ctx.beginPath();
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();

        const angle = Math.atan2(coords.y - startPos.y, coords.x - startPos.x);
        const headLen = Math.max(16, Math.round(canvas.width / 50));
        ctx.beginPath();
        ctx.moveTo(coords.x, coords.y);
        ctx.lineTo(coords.x - headLen * Math.cos(angle - Math.PI / 6), coords.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(coords.x - headLen * Math.cos(angle + Math.PI / 6), coords.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  const handlePointerUp = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isMarkupActive || !startPos) return;
    setIsDrawing(false);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const coords = getCanvasCoordinates(e);

    if (markupTool === 'rect') {
      ctx.strokeStyle = markupColor;
      ctx.lineWidth = Math.max(4, Math.round(canvas.width / 200));
      ctx.strokeRect(startPos.x, startPos.y, coords.x - startPos.x, coords.y - startPos.y);
    } else if (markupTool === 'arrow') {
      // Draw arrow from startPos to coords
      ctx.strokeStyle = markupColor;
      ctx.fillStyle = markupColor;
      ctx.lineWidth = Math.max(4, Math.round(canvas.width / 200));
      ctx.beginPath();
      ctx.moveTo(startPos.x, startPos.y);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();

      // Arrow head
      const angle = Math.atan2(coords.y - startPos.y, coords.x - startPos.x);
      const headLen = Math.max(16, Math.round(canvas.width / 50));
      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
      ctx.lineTo(coords.x - headLen * Math.cos(angle - Math.PI / 6), coords.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(coords.x - headLen * Math.cos(angle + Math.PI / 6), coords.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }

    // Push new snapshot to history
    setCanvasHistory(prev => [...prev, ctx.getImageData(0, 0, canvas.width, canvas.height)]);
    setStartPos(null);
    lastPosRef.current = null;
  };

  const generateMergedImage = (): string => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!img) return currentImageFile;

    const naturalWidth = img.naturalWidth || canvas?.width || img.clientWidth || 800;
    const naturalHeight = img.naturalHeight || canvas?.height || img.clientHeight || 600;

    const mergeCanvas = document.createElement('canvas');
    mergeCanvas.width = naturalWidth;
    mergeCanvas.height = naturalHeight;
    const mergeCtx = mergeCanvas.getContext('2d');
    if (!mergeCtx) return currentImageFile;

    // 1. Draw base unflattened image
    mergeCtx.drawImage(img, 0, 0, naturalWidth, naturalHeight);

    // 2. Draw canvas drawing strokes if any
    if (canvas) {
      mergeCtx.drawImage(canvas, 0, 0, naturalWidth, naturalHeight);
    }

    // 3. Draw text box annotations using exact displayed width to preserve on-screen scale
    const displayedWidth = imageRef.current?.clientWidth || canvas?.clientWidth || img.clientWidth || 500;
    textBoxes.forEach(box => {
      drawTextBoxOnCanvas(mergeCtx, box, naturalWidth, naturalHeight, displayedWidth);
    });

    const result = mergeCanvas.toDataURL('image/jpeg', 0.92);
    // Explicitly release backing canvas buffer to avoid memory accumulation on iOS WebKit
    mergeCanvas.width = 0;
    mergeCanvas.height = 0;
    return result;
  };

  const handleUndo = () => {
    const canvas = canvasRef.current;
    if (canvas && canvasHistory.length > 1) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const nextHistory = canvasHistory.slice(0, -1);
        const last = nextHistory[nextHistory.length - 1];
        ctx.putImageData(last, 0, 0);
        setCanvasHistory(nextHistory);
        return;
      }
    }

    if (textBoxes.length > 0) {
      setTextBoxes(prev => prev.slice(0, -1));
      setSelectedTextBoxId(null);
    }
  };

  const handleApplyMarkup = () => {
    const merged = generateMergedImage();
    setCurrentImageFile(merged);
    setIsMarkupActive(false);
    setSelectedTextBoxId(null);
  };

  const handleCancelMarkup = () => {
    setIsMarkupActive(false);
    setSelectedTextBoxId(null);
    setCurrentImageFile(photo.imageFile);
    setTextBoxes(photo.textBoxAnnotations || []);
  };

  // Handle Save Photo Details
  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const targetIssue = issues.find(i => i.id === selectedIssueId) || issue;
      const finalImage = isMarkupActive ? generateMergedImage() : currentImageFile;

      const updated: Photo = {
        ...photo,
        reportId: report.id,
        imageFile: finalImage,
        originalImageFile: baseImageFile,
        textBoxAnnotations: textBoxes,
        description: description.trim(),
        internalNotes: internalNotes.trim(),
        includeInReport,
        isReferenceImage: photo.isReferenceImage || false,
        issueId: targetIssue.id,
        issueNumber: targetIssue.issueNumber,
        jobReference: report.jobReference,
        capturedAt: capturedAt !== undefined ? capturedAt : (photo.capturedAt ?? null),
      };

      const ok = await onSavePhoto(updated);
      if (ok) {
        setSaveSuccess(true);
        onBack();
      } else {
        setSaveError('Failed to save photo updates. Please retry.');
      }
    } catch (err: any) {
      setSaveError(err.message || 'Error occurred while saving photo details.');
    } finally {
      setIsSaving(false);
    }
  };

  // Confirm and execute Photo deletion
  const handleConfirmDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const ok = await onDeletePhoto(photo.id);
      if (!ok) {
        setDeleteError('Failed to delete photo from storage. Please try again.');
        setIsDeleting(false);
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Error occurred while deleting photo.');
      setIsDeleting(false);
    }
  };

  // Derive linked issue representation
  const linkedIssue = issues.find(i => i.id === selectedIssueId) || issue;
  const linkedIssueNumStr = `Issue ${String(linkedIssue.issueNumber).padStart(2, '0')}`;
  const linkedIssueLabel = `${linkedIssueNumStr} · ${linkedIssue.issueName || 'Inspection Defect Record'}`;

  // Evidence sequence and position within the issue's evidence collection
  const photoIndex = (photos || []).findIndex(p => p.id === photo.id);
  const evidenceNumber = photo.sequenceNumber ?? (photoIndex >= 0 ? photoIndex + 1 : 1);
  const totalPhotosCount = (photos && photos.length > 0) ? photos.length : 1;
  const evidenceNumStr = `EVIDENCE #${String(evidenceNumber).padStart(2, '0')}`;

  const hasPrev = photoIndex > 0;
  const hasNext = photoIndex >= 0 && photoIndex < photos.length - 1;

  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto px-4 py-4 sm:px-6 sm:py-6 space-y-5 sm:space-y-7">
      {/* Header: Back navigation to Issue Detail and sequential evidence navigation */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#0E1E2B]/10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#0E1E2B]/15 bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] text-[#0E1E2B] font-mono font-bold text-xs uppercase tracking-wider touch-manipulation min-h-[44px] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30"
          aria-label="Return to issue detail"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
          <span>ISSUE {String(issue.issueNumber).padStart(2, '0')}</span>
        </button>

        {photos && photos.length > 1 && onSelectPhoto && (
          <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-[#0E1E2B]/15 shadow-2xs">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={() => {
                if (hasPrev) onSelectPhoto(photos[photoIndex - 1].id);
              }}
              className="px-2 py-1 rounded text-xs font-bold font-mono text-[#0E1E2B] hover:bg-[#F4F6F8] disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed touch-manipulation min-h-[32px] transition-opacity"
              title="Previous Evidence Photo"
              aria-label="Previous Evidence Photo"
            >
              ← Prev
            </button>
            <span className="text-[11px] font-mono text-[#0E1E2B]/60 px-1 select-none">
              {photoIndex + 1} of {photos.length}
            </span>
            <button
              type="button"
              disabled={!hasNext}
              onClick={() => {
                if (hasNext) onSelectPhoto(photos[photoIndex + 1].id);
              }}
              className="px-2 py-1 rounded text-xs font-bold font-mono text-[#0E1E2B] hover:bg-[#F4F6F8] disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed touch-manipulation min-h-[32px] transition-opacity"
              title="Next Evidence Photo"
              aria-label="Next Evidence Photo"
            >
              Next →
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/50 hidden sm:inline-block">
            REPORT REF:
          </span>
          <span className="font-mono font-bold text-xs sm:text-sm text-[#0E1E2B] bg-white px-2.5 py-1 rounded-md border border-[#0E1E2B]/15 inline-block">
            {report.jobReference}
          </span>
        </div>
      </div>

      {/* 1. TOP BRANDED EVIDENCE IDENTITY BLOCK (SKY CYAN SURFACE) */}
      <header className="w-full bg-[#B2E5F6] border border-[#0E1E2B]/15 rounded-xl p-4 sm:p-5 space-y-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-xs uppercase tracking-[0.2em] text-[#0E1E2B]">
              PHOTO {evidenceNumber}
            </span>
            <span className="text-[#0E1E2B]/30 font-mono text-xs">·</span>
            <span className="font-mono text-xs uppercase tracking-wider text-[#0E1E2B]/75">
              Evidence #{String(evidenceNumber).padStart(2, '0')}
            </span>
            <span className="text-[#0E1E2B]/30 font-mono text-xs">·</span>
            {/* Clear indication that evidence type is a photograph */}
            <span className="inline-flex items-center gap-1 font-mono font-bold text-[11px] uppercase tracking-wider text-[#0E1E2B]/80 bg-white/60 px-2 py-0.5 rounded border border-[#0E1E2B]/10">
              <Camera className="w-3 h-3 stroke-[2.2]" />
              <span>Photograph Evidence</span>
            </span>
          </div>

          <span className="font-mono text-xs text-[#0E1E2B]/70 bg-white/70 px-2.5 py-0.5 rounded border border-[#0E1E2B]/10">
            FIELD EVIDENCE
          </span>
        </div>

        {/* Linked issue clearly visible: "Issue 01 · Structural Foundation Crack" */}
        <div className="pt-1">
          <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/60 mb-0.5">
            LINKED DEFECT ISSUE
          </span>
          <h1
            title={linkedIssueLabel}
            className="text-lg sm:text-2xl font-brand font-bold text-[#0E1E2B] tracking-tight leading-snug break-words"
          >
            {linkedIssueLabel}
          </h1>
        </div>

        <div className="pt-2 border-t border-[#0E1E2B]/15 flex items-center justify-between text-xs text-[#0E1E2B] flex-wrap gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <Clock className="w-3.5 h-3.5 text-[#0E1E2B]/60 shrink-0" />
            <span className="text-[11px] font-mono text-[#0E1E2B]/75 uppercase">
              CAPTURED:
            </span>
            <span className={`text-[11px] font-mono ${capturedAt ? 'font-semibold text-[#0E1E2B]' : 'text-[#0E1E2B]/55 italic'}`}>
              {formatCaptureDateTime(capturedAt)}
            </span>
          </div>
          <span className="font-mono font-bold text-[11px] bg-white px-2 py-0.5 rounded border border-[#0E1E2B]/15">
            {report.jobReference}
          </span>
        </div>
      </header>

      {/* 2. PHOTOGRAPH DISPLAY - PRIMARY VISUAL ELEMENT OF THE PAGE */}
      <section className="space-y-3 pt-0.5">
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#061D24]">
              EVIDENCE PHOTOGRAPH
            </h2>
          </div>

          {/* Draw / Markup action directly associated with the photograph */}
          <div>
            {!isMarkupActive ? (
              <button
                type="button"
                onClick={() => setIsMarkupActive(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] border border-[#0E1E2B]/20 hover:border-[#0E1E2B] rounded-lg text-xs font-bold text-[#0E1E2B] transition-colors cursor-pointer touch-manipulation min-h-[38px] shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30"
                aria-label="Draw or markup photographic evidence"
              >
                <PenTool className="w-3.5 h-3.5 text-[#628EF7]" />
                <span>Draw / Markup</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#628EF7]/10 border border-[#628EF7]/30 rounded-lg text-xs font-bold text-[#628EF7] font-mono">
                <span className="w-2 h-2 rounded-full bg-[#628EF7] animate-pulse" />
                <span>Markup Mode</span>
              </span>
            )}
          </div>
        </div>

        {/* Markup Toolbar when active */}
        {isMarkupActive && (
          <div className="bg-[#0E1E2B] text-white p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-md border border-[#0E1E2B]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-[#B2E5F6]">Tool:</span>
              <button
                type="button"
                onClick={() => setMarkupTool('pen')}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                  markupTool === 'pen' ? 'bg-[#628EF7] text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                Freehand
              </button>
              <button
                type="button"
                onClick={() => setMarkupTool('arrow')}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                  markupTool === 'arrow' ? 'bg-[#628EF7] text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                Arrow
              </button>
              <button
                type="button"
                onClick={() => setMarkupTool('rect')}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                  markupTool === 'rect' ? 'bg-[#628EF7] text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                Box
              </button>
              <button
                type="button"
                onClick={() => setMarkupTool('text')}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                  markupTool === 'text' ? 'bg-[#628EF7] text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                <span>Text Box</span>
              </button>

              <div className="h-4 w-px bg-white/20 mx-1 hidden sm:block" />

              <span className="text-xs font-mono text-[#B2E5F6]">Color:</span>
              <button
                type="button"
                onClick={() => handleColorChange('#EF4444')}
                className={`w-6 h-6 rounded-full bg-rose-500 border-2 cursor-pointer ${
                  markupColor === '#EF4444' ? 'border-white scale-110' : 'border-transparent'
                }`}
                title="Signal Red"
              />
              <button
                type="button"
                onClick={() => handleColorChange('#FACC15')}
                className={`w-6 h-6 rounded-full bg-amber-400 border-2 cursor-pointer ${
                  markupColor === '#FACC15' ? 'border-white scale-110' : 'border-transparent'
                }`}
                title="Caution Yellow"
              />
              <button
                type="button"
                onClick={() => handleColorChange('#628EF7')}
                className={`w-6 h-6 rounded-full bg-[#628EF7] border-2 cursor-pointer ${
                  markupColor === '#628EF7' ? 'border-white scale-110' : 'border-transparent'
                }`}
                title="Assured Blue"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleUndo}
                disabled={canvasHistory.length <= 1 && textBoxes.length === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={handleApplyMarkup}
                className="inline-flex items-center gap-1 px-3 py-1 rounded bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white text-xs font-bold cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Apply</span>
              </button>
              <button
                type="button"
                onClick={handleCancelMarkup}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-white cursor-pointer"
                aria-label="Cancel markup"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {markupTool === 'text' && (
              <div className="w-full text-[11px] font-mono text-[#B2E5F6]/90 pt-1.5 border-t border-white/15 flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-[#628EF7] shrink-0" />
                <span>Click or tap anywhere on the photo to place a text box. Drag handle to move, click text to edit.</span>
              </div>
            )}
          </div>
        )}

        {/* Dominant Photograph Presentation: Slightly more vertical prominence (min-h: 320px on mobile, 480px on desktop; max-h 76vh), natural aspect ratio */}
        <div className="relative w-full bg-[#0E1E2B] rounded-xl border border-[#0E1E2B]/15 overflow-hidden shadow-sm flex items-center justify-center min-h-[320px] sm:min-h-[480px]">
          <div ref={imageContainerRef} className="relative inline-block max-w-full">
            <img
              ref={imageRef}
              src={isMarkupActive ? baseImageFile : currentImageFile}
              alt={description || `Evidence photo for ${linkedIssueLabel}`}
              className="w-full h-auto max-h-[76vh] object-contain block mx-auto"
            />

            {/* Interactive Canvas Overlay in Markup Mode */}
            {isMarkupActive && (
              <canvas
                ref={canvasRef}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
                onTouchCancel={handlePointerUp}
                className={`absolute inset-0 w-full h-full touch-none z-10 ${
                  markupTool === 'text' ? 'cursor-text' : 'cursor-crosshair'
                }`}
              />
            )}

            {/* Interactive Text Boxes in Markup Mode */}
            {isMarkupActive &&
              textBoxes.map(box => {
                const isSelected = selectedTextBoxId === box.id;
                const boxColor = box.color || '#EF4444';
                const scale = box.scale || 1.0;
                const fontSize = Math.round(14 * scale);
                const paddingX = Math.round(8 * scale);
                const paddingY = Math.round(4 * scale);
                const iconSize = Math.max(12, Math.round(14 * Math.min(1.8, Math.max(0.75, scale))));

                return (
                  <div
                    key={box.id}
                    id={`markup_textbox_${box.id}`}
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedTextBoxId(box.id);
                    }}
                    className={`absolute z-20 group rounded-md border-2 transition-shadow inline-flex items-start ${
                      isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-black/60 shadow-xl' : 'hover:opacity-95 shadow-md'
                    }`}
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      maxWidth: 'min(92%, 600px)',
                      borderColor: boxColor,
                      backgroundColor: 'transparent',
                    }}
                  >
                    <div
                      className="flex items-start gap-1 w-full"
                      style={{ padding: `${paddingY}px ${paddingX}px` }}
                    >
                      {/* Drag handle to move text box */}
                      <div
                        onMouseDown={e => handleTextBoxPointerDown(e, box.id)}
                        onTouchStart={e => handleTextBoxPointerDown(e, box.id)}
                        className="touch-none cursor-grab active:cursor-grabbing p-0.5 opacity-80 hover:opacity-100 transition-opacity mt-0.5 shrink-0"
                        style={{ color: boxColor, textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
                        title="Drag to move text box"
                        aria-label="Drag to move text box"
                      >
                        <GripVertical style={{ width: `${iconSize}px`, height: `${iconSize}px` }} className="stroke-[2.5]" />
                      </div>

                      {/* Scaled Text Input Container */}
                      <div
                        className="relative inline-grid items-center font-mono font-bold min-w-0 flex-1"
                        style={{ gridTemplateColumns: '1fr', fontSize: `${fontSize}px` }}
                      >
                        {/* Hidden measuring span that dictates exact grid width and height */}
                        <span
                          className="invisible whitespace-pre-wrap px-1.5 py-0.5 col-start-1 row-start-1 pointer-events-none select-none break-words min-w-0"
                          style={{
                            minWidth: '2ch',
                            maxWidth: '100%',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          }}
                          aria-hidden="true"
                        >
                          {box.text ? (box.text.endsWith('\n') ? box.text + ' ' : box.text) : 'Note...'}
                        </span>
                        <textarea
                          rows={1}
                          value={box.text}
                          onChange={e => handleUpdateTextBoxText(box.id, e.target.value)}
                          onFocus={() => setSelectedTextBoxId(box.id)}
                          placeholder="Note..."
                          className="col-start-1 row-start-1 w-full h-full min-w-0 bg-transparent font-mono font-bold px-1.5 py-0.5 outline-none resize-none overflow-hidden break-words whitespace-pre-wrap"
                          style={{
                            fontSize: `${fontSize}px`,
                            color: boxColor,
                            textShadow: '0 1px 2px rgba(0, 0, 0, 0.95), 0 0 3px rgba(0, 0, 0, 0.9)',
                            caretColor: boxColor,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          }}
                          autoFocus={isSelected && !box.text}
                        />
                      </div>

                      {/* Delete button to remove text box */}
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteTextBox(box.id);
                        }}
                        className="p-0.5 opacity-75 hover:opacity-100 rounded cursor-pointer transition-opacity mt-0.5 shrink-0"
                        style={{ color: boxColor, textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
                        title="Delete text box"
                        aria-label="Delete text box"
                      >
                        <X style={{ width: `${iconSize}px`, height: `${iconSize}px` }} className="stroke-[2.5]" />
                      </button>
                    </div>

                    {/* Visible corner resize handle when selected */}
                    {isSelected && (
                      <div
                        onMouseDown={e => handleTextBoxResizePointerDown(e, box.id)}
                        onTouchStart={e => handleTextBoxResizePointerDown(e, box.id)}
                        className="absolute -bottom-2 -right-2 w-5 h-5 rounded-full bg-white border-2 flex items-center justify-center shadow-md touch-none cursor-nwse-resize hover:scale-125 active:scale-125 transition-transform z-30 select-none"
                        style={{ borderColor: boxColor }}
                        title="Drag to resize text box and font"
                        aria-label="Drag to resize text box and font"
                      >
                        <div
                          className="w-2 h-2 border-r-2 border-b-2"
                          style={{ borderColor: boxColor }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </section>

      {/* 3. OBSERVATION SECTION - Preserved with Describe by Voice & generous vertical space */}
      <section className="space-y-3 pt-1">
        <div className="border-b border-[#0E1E2B]/10 pb-2 flex items-center justify-between">
          <div>
            <h2 className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#0E1E2B]">
              OBSERVATION
            </h2>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#0E1E2B]/15 p-4 sm:p-5 shadow-2xs space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
              <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80">
                Defect Observations &amp; Field Notes
              </label>
              {/* Live Character Counter: 250 recommended limit with overflow tracking */}
              <div className="flex items-center gap-1.5 font-mono text-[11px] flex-wrap">
                <span className={isDescOverLimit ? 'font-bold text-red-600' : 'text-[#0E1E2B]/60 font-medium'}>
                  {descCharCount} / 250
                </span>
                {isDescOverLimit && (
                  <span className="font-semibold text-red-600 bg-red-50 border border-red-200/80 px-1.5 py-0.5 rounded text-[10px]">
                    {descOverflowCount} {descOverflowCount === 1 ? 'character' : 'characters'} over limit
                  </span>
                )}
              </div>
            </div>

            {/* Photo Description textarea with live 250-char limit & red overflow styling */}
            <div className="relative w-full bg-white rounded-lg">
              {isDescOverLimit && (
                <div
                  ref={descriptionBackdropRef}
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full text-sm sm:text-base font-normal px-3.5 py-3 rounded-lg leading-relaxed break-words whitespace-pre-wrap overflow-hidden pointer-events-none select-none border border-transparent"
                  style={{
                    paddingRight: `${14 + descriptionScrollbarOffset}px`,
                  }}
                >
                  <span className="text-[#0E1E2B]">{descValidText}</span>
                  <span className="text-red-600 bg-red-500/10 font-normal">
                    {descOverflowText}
                    {description.endsWith('\n') ? ' ' : ''}
                  </span>
                </div>
              )}
              <textarea
                ref={descriptionTextareaRef}
                value={description}
                onChange={e => setDescription(e.target.value)}
                onScroll={syncDescriptionScroll}
                placeholder="Record detailed defect observations, physical dimensions, material degradation, crack orientation, water ingress, or remediation requirements..."
                rows={6}
                className={`w-full text-sm sm:text-base font-normal px-3.5 py-3 rounded-lg border focus:ring-2 outline-none transition-colors min-h-[150px] leading-relaxed break-words whitespace-pre-wrap relative z-[1] selection:bg-[#628EF7]/30 ${
                  isDescOverLimit
                    ? 'bg-transparent text-transparent caret-[#0E1E2B] border-red-300 focus:border-red-500 focus:ring-red-500/20'
                    : 'bg-white text-[#0E1E2B] border-[#0E1E2B]/20 focus:border-[#628EF7] focus:ring-[#628EF7]/20 placeholder:text-[#0E1E2B]/40'
                }`}
              />
            </div>
          </div>

          {/* Voice Transcription helper: Preserved functionality */}
          <div>
            <VoiceTranscriptionControl onTranscriptReceived={handleTranscriptReceived} />
          </div>

          {/* Surveyor Field Notes (Internal Only) */}
          <div className="pt-3 border-t border-[#0E1E2B]/10">
            <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
              Surveyor Field Notes (Internal Only)
            </label>
            <textarea
              value={internalNotes}
              onChange={e => setInternalNotes(e.target.value)}
              placeholder="Add internal notes for this photo…"
              rows={3}
              className="w-full text-sm font-normal px-3.5 py-2.5 bg-[#F8FAFC] border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] placeholder:text-[#0E1E2B]/40 focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all leading-relaxed"
            />
          </div>

          {/* Include in Photo Report Toggle */}
          <div
            role="switch"
            aria-checked={includeInReport}
            tabIndex={0}
            onClick={() => setIncludeInReport(!includeInReport)}
            onKeyDown={e => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setIncludeInReport(!includeInReport);
              }
            }}
            className={`p-3 rounded-lg border transition-colors flex items-center justify-between gap-3 cursor-pointer select-none ${
              includeInReport
                ? 'bg-[#F0F7FF] border-[#628EF7]/30 hover:bg-[#E8F2FD]'
                : 'bg-[#F8FAFC] border-[#0E1E2B]/15 hover:bg-[#F1F5F9]'
            }`}
          >
            <div>
              <span className="block text-xs sm:text-sm font-semibold text-[#0E1E2B]">
                Include in Photo Report
              </span>
            </div>
            <div
              className={`relative inline-flex h-[26px] w-[46px] items-center rounded-full p-[3px] transition-colors duration-200 ease-in-out flex-shrink-0 ${
                includeInReport ? 'bg-[#628EF7]' : 'bg-[#CBD5E1]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  includeInReport ? 'translate-x-[20px]' : 'translate-x-0'
                }`}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 4. METADATA & REASSIGNMENT - Visually secondary to photo and observation */}
      <section className="space-y-3 pt-1">
        <div className="border-b border-[#0E1E2B]/10 pb-2">
          <h2 className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#0E1E2B]/70">
            METADATA &amp; REASSIGNMENT
          </h2>
        </div>

        <div className="bg-white rounded-xl border border-[#0E1E2B]/15 p-4 sm:p-5 space-y-4">
          {/* Original Photo Capture Date & Time Metadata */}
          <div>
            <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/75 mb-1.5">
              Original Photo Capture Date &amp; Time
            </label>
            <div className="flex items-center gap-2 text-xs font-mono bg-[#F8FAFC] border border-[#0E1E2B]/15 px-3.5 py-2.5 rounded-lg text-[#0E1E2B]">
              <Clock className="w-4 h-4 text-[#0E1E2B]/50 shrink-0" />
              {capturedAt ? (
                <span className="font-semibold text-[#0E1E2B]">{formatCaptureDateTime(capturedAt)}</span>
              ) : (
                <span className="text-[#0E1E2B]/50 italic">Capture date/time unavailable</span>
              )}
            </div>
          </div>

          {/* Reassign Issue Selector */}
          <div>
            <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/75 mb-1.5">
              Associated Defect Issue
            </label>
            {issues.length > 0 ? (
              <select
                value={selectedIssueId}
                onChange={e => setSelectedIssueId(e.target.value)}
                className="w-full text-sm font-medium px-3.5 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
              >
                {issues.map(iss => (
                  <option key={iss.id} value={iss.id}>
                    Issue {String(iss.issueNumber).padStart(2, '0')}: {iss.issueName || '(Untitled Defect)'}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-[#F4F6F8] rounded-lg border border-[#0E1E2B]/15 text-xs font-mono text-[#0E1E2B]">
                Issue {issue.issueNumber}: {issue.issueName || 'Current Defect'}
              </div>
            )}
          </div>

          {/* Technical Storage Reference: Hidden behind an optional "Technical Details" disclosure */}
          <div className="pt-3 border-t border-[#0E1E2B]/10">
            <button
              type="button"
              onClick={() => setShowTechnicalDetails(prev => !prev)}
              className="inline-flex items-center justify-between w-full text-left py-1 text-xs font-mono font-bold text-[#0E1E2B]/60 hover:text-[#0E1E2B] cursor-pointer touch-manipulation"
              aria-expanded={showTechnicalDetails}
            >
              <span className="uppercase tracking-wider">Technical Details</span>
              {showTechnicalDetails ? (
                <ChevronUp className="w-4 h-4 text-[#0E1E2B]/60" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[#0E1E2B]/60" />
              )}
            </button>

            {showTechnicalDetails && (
              <div className="mt-2.5 p-3 bg-[#F4F6F8] rounded-lg border border-[#0E1E2B]/10 text-[11px] font-mono space-y-1.5 text-[#0E1E2B]/75">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#0E1E2B]/50">ORIGINAL CAPTURE:</span>
                  <span className={`truncate max-w-[65%] ${capturedAt ? 'font-semibold text-[#0E1E2B]' : 'text-[#0E1E2B]/40 italic'}`}>
                    {formatCaptureDateTime(capturedAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#0E1E2B]/50">STORAGE REF:</span>
                  <span className="truncate max-w-[65%] font-semibold text-[#0E1E2B]">
                    {photo.storageUri || `${report.jobReference}_P${photo.issueNumber}`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#0E1E2B]/50">EVIDENCE ID:</span>
                  <span className="truncate max-w-[65%] text-[#0E1E2B]/70">{photo.id}</span>
                </div>
                {photo.createdAt && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#0E1E2B]/50">RECORDED:</span>
                    <span>{new Date(photo.createdAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 5. PRIMARY FINAL ACTION: SAVE PHOTO */}
      <div className="pt-2 space-y-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={`w-full py-3.5 px-6 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[48px] sm:min-h-[52px] shadow-sm flex items-center justify-center gap-2.5 transition-colors touch-manipulation active:scale-[0.99] cursor-pointer ${
            saveSuccess
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white focus:ring-4 focus:ring-[#628EF7]/25'
          } ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {isSaving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Saving Photo...</span>
            </>
          ) : saveSuccess ? (
            <>
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Photo Saved!</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4 stroke-[2.2]" />
              <span>SAVE PHOTO</span>
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

      {/* 6. SECONDARY DESTRUCTIVE ACTION: DELETE PHOTO */}
      <div className="pt-6 sm:pt-8 border-t border-[#0E1E2B]/10">
        <button
          type="button"
          onClick={() => setIsDeleteDialogOpen(true)}
          className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-rose-50/60 active:bg-rose-100/60 border border-[#0E1E2B]/15 hover:border-rose-300 text-[#0E1E2B]/70 hover:text-rose-700 font-semibold text-xs min-h-[44px] transition-colors touch-manipulation cursor-pointer flex items-center justify-center gap-2"
        >
          <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
          <span>Delete Photo</span>
        </button>

        {deleteError && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs font-semibold">
            {deleteError}
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Delete Photo */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        title="Delete Photo"
        message="Delete this photo?"
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
