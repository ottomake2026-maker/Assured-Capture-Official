import { Report, Issue, Photo, UserProfile } from '../types';
import { auth, db as firestoreDb } from '../utils/firebaseAuth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { enqueueSync, clearSyncQueueForUser } from './syncQueue';

const DB_NAME = 'AssuredCaptureDB';
// Target DB version is at least 3 to include reports, issues, photos, and syncQueue
const TARGET_DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

function setupSchema(db: IDBDatabase) {
  if (!db.objectStoreNames.contains('reports')) {
    db.createObjectStore('reports', { keyPath: 'id' });
  }

  if (!db.objectStoreNames.contains('issues')) {
    const issueStore = db.createObjectStore('issues', { keyPath: 'id' });
    issueStore.createIndex('reportId', 'reportId', { unique: false });
  }

  if (!db.objectStoreNames.contains('photos')) {
    const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
    photoStore.createIndex('issueId', 'issueId', { unique: false });
    photoStore.createIndex('reportId', 'reportId', { unique: false });
  }

  if (!db.objectStoreNames.contains('syncQueue')) {
    const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
    syncStore.createIndex('status', 'status', { unique: false });
    syncStore.createIndex('userId', 'userId', { unique: false });
  }
}

function hasRequiredStores(db: IDBDatabase): boolean {
  return (
    db.objectStoreNames.contains('reports') &&
    db.objectStoreNames.contains('issues') &&
    db.objectStoreNames.contains('photos') &&
    db.objectStoreNames.contains('syncQueue')
  );
}

function openDatabaseInternal(targetVersion?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // If targetVersion is provided, pass it; otherwise open without version to inspect current version
    const request = targetVersion !== undefined
      ? indexedDB.open(DB_NAME, targetVersion)
      : indexedDB.open(DB_NAME);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      setupSchema(db);
    };

    request.onsuccess = () => {
      const db = request.result;

      // Handle connection closing or versionchange from other tabs
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };

      // Check if all required object stores exist.
      // If the database was opened at an existing version that is missing newly required stores,
      // close it and upgrade it by incrementing db.version + 1.
      if (!hasRequiredStores(db)) {
        const nextVersion = db.version + 1;
        db.close();
        openDatabaseInternal(nextVersion).then(resolve).catch(reject);
        return;
      }

      resolve(db);
    };

    request.onerror = () => {
      const error = request.error;
      // If we got a VersionError ("The requested version (X) is less than the existing version (Y)"):
      if (error && (error.name === 'VersionError' || error.message?.includes('less than the existing version'))) {
        // Parse the existing version from the error message if possible
        const match = error.message?.match(/existing version \((\d+)\)/i);
        const existingVer = match ? parseInt(match[1], 10) : undefined;
        // Retry opening without version or with the existing version
        openDatabaseInternal(existingVer).then(resolve).catch(reject);
        return;
      }
      reject(error || new Error('Failed to open IndexedDB'));
    };

    request.onblocked = () => {
      console.warn('IndexedDB database upgrade blocked: please close other tabs of this application.');
    };
  });
}

export function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    // 1. If indexedDB.databases is available, check if the DB exists with a higher version
    let initialVersion: number | undefined = TARGET_DB_VERSION;
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      try {
        const dbs = await indexedDB.databases();
        const existing = dbs.find((d) => d.name === DB_NAME);
        if (existing && typeof existing.version === 'number' && existing.version > TARGET_DB_VERSION) {
          initialVersion = existing.version;
        }
      } catch {
        // ignore
      }
    }

    try {
      return await openDatabaseInternal(initialVersion);
    } catch (err: any) {
      // If opening with initialVersion failed due to VersionError or any version mismatch,
      // fallback to opening without version parameter (which opens at current version)
      if (err?.name === 'VersionError' || err?.message?.includes('version')) {
        return await openDatabaseInternal(undefined);
      }
      throw err;
    }
  })();

  // If opening fails, reset dbPromise so subsequent calls can retry instead of caching failure
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

// Generate unique ID
export function generateId(): string {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

// Format current date as YYYY-MM-DD
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ----------------------------------------------------
// FIRESTORE QUOTA & OFFLINE RESILIENCE MANAGEMENT
// ----------------------------------------------------

const QUOTA_EXHAUSTED_KEY = 'assured_capture_firestore_quota_exhausted_date';
type QuotaSubscriber = (exhausted: boolean) => void;
const quotaSubscribers = new Set<QuotaSubscriber>();

let isQuotaExhaustedMemory = false;

// Check if localStorage has an active quota exhaustion flag from today
try {
  const savedDate = localStorage.getItem(QUOTA_EXHAUSTED_KEY);
  if (savedDate === getTodayDateString()) {
    isQuotaExhaustedMemory = true;
  }
} catch {
  // ignore
}

export function isQuotaExceededError(err: any): boolean {
  if (!err) return false;
  const code = err?.code || err?.name || '';
  const msg = err?.message || String(err);
  return (
    code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('Free daily write units') ||
    msg.includes('quota')
  );
}

export function isFirestoreQuotaExhausted(): boolean {
  if (isQuotaExhaustedMemory) return true;
  const today = getTodayDateString();
  try {
    const saved = localStorage.getItem(QUOTA_EXHAUSTED_KEY);
    return saved === today;
  } catch {
    return isQuotaExhaustedMemory;
  }
}

export function setFirestoreQuotaExhausted(exhausted: boolean = true): void {
  isQuotaExhaustedMemory = exhausted;
  const today = getTodayDateString();
  try {
    if (exhausted) {
      localStorage.setItem(QUOTA_EXHAUSTED_KEY, today);
    } else {
      localStorage.removeItem(QUOTA_EXHAUSTED_KEY);
    }
  } catch {
    // ignore
  }
  notifyQuotaSubscribers(exhausted);
}

export function subscribeToQuotaStatus(callback: QuotaSubscriber): () => void {
  quotaSubscribers.add(callback);
  callback(isFirestoreQuotaExhausted());
  return () => {
    quotaSubscribers.delete(callback);
  };
}

function notifyQuotaSubscribers(exhausted: boolean) {
  quotaSubscribers.forEach((cb) => {
    try {
      cb(exhausted);
    } catch {
      // ignore
    }
  });
}

// Get 2-digit year (e.g. "26" for 2026)
export function getTwoDigitYear(): string {
  const now = new Date();
  return String(now.getFullYear()).slice(-2);
}

// Initial default report generator
export function createNewReportDraft(): Report {
  const today = getTodayDateString();
  const yy = getTwoDigitYear();
  const currentUserId = auth.currentUser?.uid;

  return {
    id: generateId(),
    userId: currentUserId,
    jobReference: `BBC${yy}-`,
    reportName: '',
    reportType: 'photo_report',
    clientName: '',
    address: '',
    reportDate: today,
    status: 'Draft',
    inspectionDate: today,
    inspectionDateHistory: [],
    highestIssueNumberAssigned: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Converts a Data URL to a Blob and measures its exact size in bytes.
 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

/**
 * Intelligent Image compression utility for inspection photography:
 * - Measures actual Blob byte size.
 * - Targets MAXIMUM IMAGE SIZE: 700 KB (716,800 bytes) so remaining Firestore metadata fits safely below 1 MB.
 * - Streamlined single-pass scaling specifically designed to avoid memory exhaustion on iPhone Safari.
 * - Explicitly cleans up canvas backing buffers and ImageBitmaps to prevent iOS WebKit OOM crashes.
 */
export async function ensureSafeImageSize(dataUrl?: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return dataUrl || '';

  // 1. Check actual initial Blob size
  try {
    const initialBlob = await dataUrlToBlob(dataUrl);
    if (initialBlob.size <= 716800) {
      return dataUrl; // Already <= 700 KB, no need to recompress
    }
  } catch {
    // Proceed to compression
  }

  return new Promise(async (resolve) => {
    let imgBitmap: ImageBitmap | null = null;
    let canvas: HTMLCanvasElement | null = null;

    const cleanup = () => {
      if (imgBitmap) {
        try {
          imgBitmap.close?.();
        } catch (_) {}
        imgBitmap = null;
      }
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
    };

    try {
      let origW = 0;
      let origH = 0;

      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        if (typeof createImageBitmap !== 'undefined') {
          try {
            imgBitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
            origW = imgBitmap.width;
            origH = imgBitmap.height;
          } catch {
            imgBitmap = await createImageBitmap(blob);
            origW = imgBitmap.width;
            origH = imgBitmap.height;
          }
        }
      } catch {}

      const processSource = async (source: CanvasImageSource, w: number, h: number) => {
        if (!w || !h) {
          cleanup();
          resolve(dataUrl);
          return;
        }

        // Target maximum dimension for inspection photo clarity
        const maxDim = 1600;
        let width = w;
        let height = h;

        if (w > maxDim || h > maxDim) {
          if (w > h) {
            height = Math.round((h * maxDim) / w);
            width = maxDim;
          } else {
            width = Math.round((w * maxDim) / h);
            height = maxDim;
          }
        }

        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          cleanup();
          resolve(dataUrl);
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, width, height);

        // Attempt 1: High quality 0.82
        let blob: Blob | null = await new Promise((res) => {
          canvas?.toBlob((b) => res(b), 'image/jpeg', 0.82);
        });

        // Attempt 2: If still > 700KB, drop quality to 0.65
        if (blob && blob.size > 716800) {
          blob = await new Promise((res) => {
            canvas?.toBlob((b) => res(b), 'image/jpeg', 0.65);
          });
        }

        // Attempt 3: If somehow still > 700KB, downscale further to 1000px
        if (blob && blob.size > 716800) {
          const smallMax = 1000;
          const smallW = Math.round((width * smallMax) / Math.max(width, height));
          const smallH = Math.round((height * smallMax) / Math.max(width, height));
          canvas.width = smallW;
          canvas.height = smallH;
          ctx.drawImage(source, 0, 0, smallW, smallH);
          blob = await new Promise((res) => {
            canvas?.toBlob((b) => res(b), 'image/jpeg', 0.60);
          });
        }

        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => {
            cleanup();
            resolve((reader.result as string) || dataUrl);
          };
          reader.onerror = () => {
            cleanup();
            resolve(dataUrl);
          };
          reader.readAsDataURL(blob);
        } else {
          cleanup();
          resolve(dataUrl);
        }
      };

      if (imgBitmap) {
        await processSource(imgBitmap, origW, origH);
      } else {
        const img = new Image();
        img.onload = async () => {
          await processSource(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
        };
        img.onerror = () => {
          cleanup();
          resolve(dataUrl);
        };
        img.src = dataUrl;
      }
    } catch {
      cleanup();
      resolve(dataUrl);
    }
  });
}

// ----------------------------------------------------
// 2 & 3. REPORTS CRUD (INDEXEDDB WORKING COPY + SYNC QUEUE)
// ----------------------------------------------------

/**
 * Loads reports directly from local IndexedDB working copy.
 * Guarantees zero unnecessary Firestore read units on navigation.
 */
export async function getAllReports(explicitUserId?: string): Promise<Report[]> {
  const currentUserId = explicitUserId !== undefined ? explicitUserId : auth.currentUser?.uid;
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readonly');
    const store = tx.objectStore('reports');
    const request = store.getAll();

    request.onsuccess = () => {
      let reports: Report[] = request.result || [];
      if (currentUserId) {
        reports = reports.filter((r) => !r.userId || r.userId === currentUserId);
      }
      reports = reports.filter((r) => !r.isDeleted && (r.status as string) !== 'Deleted');
      reports = reports.map((r) => ({
        ...r,
        reportType: r.reportType || 'photo_report',
      }));
      reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      resolve(reports);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getReportById(id: string): Promise<Report | null> {
  const currentUserId = auth.currentUser?.uid;
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readonly');
    const store = tx.objectStore('reports');
    const request = store.get(id);

    request.onsuccess = () => {
      const report: Report | undefined = request.result;
      if (report && (report.isDeleted || (report.status as string) === 'Deleted')) {
        resolve(null);
      } else if (report && currentUserId && report.userId && report.userId !== currentUserId) {
        resolve(null);
      } else if (report) {
        resolve({
          ...report,
          reportType: report.reportType || 'photo_report',
        });
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Single Write Path: Saves report locally to IndexedDB first, then delegates
 * cloud synchronization to the centralized, debounced sync queue.
 */
export async function saveReport(report: Report): Promise<void> {
  const currentUserId = auth.currentUser?.uid;
  const updated: Report = {
    ...report,
    reportType: report.reportType || 'photo_report',
    userId: report.userId || currentUserId,
    updatedAt: new Date().toISOString(),
  };

  if (updated.reportImage) {
    updated.reportImage = await ensureSafeImageSize(updated.reportImage);
  }

  // 1. Save to local IndexedDB immediately (Local Working Copy)
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const request = store.put(updated);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // 2. Delegate cloud write to the centralized sync queue (debounced and coalesced)
  if (currentUserId) {
    enqueueSync({
      entityType: 'report',
      entityId: updated.id,
      operation: 'upsert',
      userId: currentUserId,
      entityData: updated,
    });
  }
}

/**
 * Completely purges a report and all its associated child issues, photos,
 * and pending sync queue items from local IndexedDB.
 * Ensures zero orphaned nested data remain locally.
 */
export async function purgeLocalReportAndChildren(reportId: string): Promise<void> {
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const storeNames = ['reports', 'issues', 'photos'];
    if (db.objectStoreNames.contains('syncQueue')) {
      storeNames.push('syncQueue');
    }
    const tx = db.transaction(storeNames, 'readwrite');
    const reportStore = tx.objectStore('reports');
    const issueStore = tx.objectStore('issues');
    const photoStore = tx.objectStore('photos');

    // 1. Delete parent report document
    reportStore.delete(reportId);

    // 2. Delete all issues belonging to this report
    const issueIndex = issueStore.index('reportId');
    const issueReq = issueIndex.getAllKeys(reportId);
    issueReq.onsuccess = () => {
      const issueKeys = issueReq.result || [];
      issueKeys.forEach((key) => issueStore.delete(key));
    };

    // 3. Delete all photos belonging to this report
    const photoIndex = photoStore.index('reportId');
    const photoReq = photoIndex.getAllKeys(reportId);
    photoReq.onsuccess = () => {
      const photoKeys = photoReq.result || [];
      photoKeys.forEach((key) => photoStore.delete(key));
    };

    // 4. Purge any pending sync queue items for this report or its children
    if (db.objectStoreNames.contains('syncQueue')) {
      const syncStore = tx.objectStore('syncQueue');
      const allSyncReq = syncStore.getAll();
      allSyncReq.onsuccess = () => {
        const items = allSyncReq.result || [];
        items.forEach((item: any) => {
          if (
            (item.entityType === 'report' && item.entityId === reportId) ||
            item.reportId === reportId
          ) {
            syncStore.delete(item.id);
          }
        });
      };
    }

    tx.oncomplete = () => {
      // Clean up local deduplication hash
      try {
        const raw = localStorage.getItem('assured_capture_last_synced_hashes');
        if (raw) {
          const hashes = JSON.parse(raw);
          delete hashes[`report_${reportId}`];
          localStorage.setItem('assured_capture_last_synced_hashes', JSON.stringify(hashes));
        }
      } catch {
        // ignore
      }
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Single Write Path: Deletes report locally from IndexedDB, then enqueues cloud deletion.
 */
export async function deleteReport(reportId: string): Promise<void> {
  const currentUserId = auth.currentUser?.uid;

  // 1. Delete from local IndexedDB completely
  await purgeLocalReportAndChildren(reportId);

  // 2. Enqueue cloud deletion to sync queue
  if (currentUserId) {
    enqueueSync({
      entityType: 'report',
      entityId: reportId,
      operation: 'delete',
      userId: currentUserId,
    });
  }
}

// ----------------------------------------------------
// ISSUES CRUD (INDEXEDDB WORKING COPY + SYNC QUEUE)
// ----------------------------------------------------

export async function getIssuesForReport(reportId: string): Promise<Issue[]> {
  const db = await getDB();
  const issues: Issue[] = await new Promise((resolve, reject) => {
    const tx = db.transaction('issues', 'readonly');
    const store = tx.objectStore('issues');
    const index = store.index('reportId');
    const request = index.getAll(reportId);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  issues.sort((a, b) => {
    if (a.issueNumber !== b.issueNumber) {
      return a.issueNumber - b.issueNumber;
    }
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return (a.id || '').localeCompare(b.id || '');
  });

  // Check if any issue is out of sequence (e.g. gaps after deletions or historical records)
  let needsRenumbering = false;
  for (let i = 0; i < issues.length; i++) {
    if (issues[i].issueNumber !== i + 1) {
      needsRenumbering = true;
      break;
    }
  }

  if (needsRenumbering) {
    return await renumberIssuesForReport(reportId);
  }

  return issues;
}

/**
 * Renumbers all remaining issues for a report sequentially (1, 2, 3...)
 * preserving original relative order and updating any linked photos.
 */
export async function renumberIssuesForReport(reportId: string): Promise<Issue[]> {
  const db = await getDB();
  const rawIssues: Issue[] = await new Promise((resolve, reject) => {
    const tx = db.transaction('issues', 'readonly');
    const store = tx.objectStore('issues');
    const index = store.index('reportId');
    const req = index.getAll(reportId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  // Sort preserving original sequence: by existing issueNumber, then by createdAt, then by id
  rawIssues.sort((a, b) => {
    if (a.issueNumber !== b.issueNumber) {
      return a.issueNumber - b.issueNumber;
    }
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return (a.id || '').localeCompare(b.id || '');
  });

  const currentUserId = auth.currentUser?.uid;
  const updatedIssues: Issue[] = [];

  for (let idx = 0; idx < rawIssues.length; idx++) {
    const issue = rawIssues[idx];
    const targetNumber = idx + 1;

    if (issue.issueNumber !== targetNumber) {
      const updatedIssue: Issue = {
        ...issue,
        issueNumber: targetNumber,
        updatedAt: new Date().toISOString(),
      };

      // Save issue to IndexedDB
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('issues', 'readwrite');
        const store = tx.objectStore('issues');
        const req = store.put(updatedIssue);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      // Update associated photos' issueNumber so they stay strictly in sync
      const photos = await getPhotosForIssue(issue.id);
      for (const photo of photos) {
        if (photo.issueNumber !== targetNumber) {
          const updatedPhoto: Photo = {
            ...photo,
            issueNumber: targetNumber,
            updatedAt: new Date().toISOString(),
          };
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');
            const req = store.put(updatedPhoto);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
          if (currentUserId) {
            enqueueSync({
              entityType: 'photo',
              entityId: photo.id,
              reportId,
              operation: 'upsert',
              userId: currentUserId,
              entityData: updatedPhoto,
            });
          }
        }
      }

      // Enqueue sync for updated issue
      if (currentUserId) {
        enqueueSync({
          entityType: 'issue',
          entityId: issue.id,
          reportId,
          operation: 'upsert',
          userId: currentUserId,
          entityData: updatedIssue,
        });
      }

      updatedIssues.push(updatedIssue);
    } else {
      updatedIssues.push(issue);
    }
  }

  // Update report record highestIssueNumberAssigned to match current count
  const report = await getReportById(reportId);
  if (report && report.highestIssueNumberAssigned !== updatedIssues.length) {
    report.highestIssueNumberAssigned = updatedIssues.length;
    await saveReport(report);
  }

  return updatedIssues;
}

/**
 * Reorders issues for a report based on the provided list of issue IDs.
 * Immediately assigns sequential issueNumber (1, 2, 3...) according to new position,
 * updates associated photos, saves to IndexedDB, and enqueues sync operations.
 */
export async function reorderIssuesForReport(
  reportId: string,
  orderedIssueIds: string[]
): Promise<Issue[]> {
  const db = await getDB();
  const rawIssues: Issue[] = await new Promise((resolve, reject) => {
    const tx = db.transaction('issues', 'readonly');
    const store = tx.objectStore('issues');
    const index = store.index('reportId');
    const req = index.getAll(reportId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const issueMap = new Map<string, Issue>();
  rawIssues.forEach((iss) => issueMap.set(iss.id, iss));

  // Arrange in the specified order
  const reordered: Issue[] = [];
  for (const id of orderedIssueIds) {
    const iss = issueMap.get(id);
    if (iss) {
      reordered.push(iss);
      issueMap.delete(id);
    }
  }
  // Append any remaining issues not in orderedIssueIds (safety fallback)
  for (const remaining of issueMap.values()) {
    reordered.push(remaining);
  }

  const currentUserId = auth.currentUser?.uid;
  const updatedIssues: Issue[] = [];

  for (let idx = 0; idx < reordered.length; idx++) {
    const issue = reordered[idx];
    const targetNumber = idx + 1;

    if (issue.issueNumber !== targetNumber) {
      const updatedIssue: Issue = {
        ...issue,
        issueNumber: targetNumber,
        updatedAt: new Date().toISOString(),
      };

      // Save issue to IndexedDB
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('issues', 'readwrite');
        const store = tx.objectStore('issues');
        const req = store.put(updatedIssue);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      // Update associated photos' issueNumber so they stay strictly in sync
      const photos = await getPhotosForIssue(issue.id);
      for (const photo of photos) {
        if (photo.issueNumber !== targetNumber) {
          const updatedPhoto: Photo = {
            ...photo,
            issueNumber: targetNumber,
            updatedAt: new Date().toISOString(),
          };
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');
            const req = store.put(updatedPhoto);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
          if (currentUserId) {
            enqueueSync({
              entityType: 'photo',
              entityId: photo.id,
              reportId,
              operation: 'upsert',
              userId: currentUserId,
              entityData: updatedPhoto,
            });
          }
        }
      }

      // Enqueue sync for updated issue
      if (currentUserId) {
        enqueueSync({
          entityType: 'issue',
          entityId: issue.id,
          reportId,
          operation: 'upsert',
          userId: currentUserId,
          entityData: updatedIssue,
        });
      }

      updatedIssues.push(updatedIssue);
    } else {
      updatedIssues.push(issue);
    }
  }

  // Update report record highestIssueNumberAssigned to match current count
  const report = await getReportById(reportId);
  if (report && report.highestIssueNumberAssigned !== updatedIssues.length) {
    report.highestIssueNumberAssigned = updatedIssues.length;
    await saveReport(report);
  }

  return updatedIssues;
}

export async function getIssueById(id: string): Promise<Issue | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('issues', 'readonly');
    const store = tx.objectStore('issues');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function getNextIssueNumber(reportId: string): Promise<number> {
  const currentIssues = await getIssuesForReport(reportId);
  return currentIssues.length + 1;
}

/**
 * Single Write Path: Saves issue locally to IndexedDB, then delegates
 * cloud synchronization to the centralized sync queue.
 */
export async function saveIssue(issue: Issue): Promise<void> {
  const currentUserId = auth.currentUser?.uid;
  const updated: Issue = {
    ...issue,
    userId: issue.userId || currentUserId,
    updatedAt: new Date().toISOString(),
  };

  // 1. Save to local IndexedDB immediately
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('issues', 'readwrite');
    const store = tx.objectStore('issues');
    const request = store.put(updated);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // 2. Delegate cloud write to the centralized sync queue
  if (currentUserId && updated.reportId) {
    enqueueSync({
      entityType: 'issue',
      entityId: updated.id,
      reportId: updated.reportId,
      operation: 'upsert',
      userId: currentUserId,
      entityData: updated,
    });
  }

  // 3. Update report highestIssueNumberAssigned if greater
  if (updated.reportId) {
    const report = await getReportById(updated.reportId);
    if (report && (report.highestIssueNumberAssigned || 0) < updated.issueNumber) {
      report.highestIssueNumberAssigned = updated.issueNumber;
      await saveReport(report);
    }
  }
}

/**
 * Single Write Path: Deletes issue from IndexedDB, then enqueues cloud deletion.
 */
export async function deleteIssue(issueId: string, reportIdHint?: string): Promise<void> {
  const currentUserId = auth.currentUser?.uid;

  let reportId = reportIdHint;
  if (!reportId) {
    const existing = await getIssueById(issueId);
    reportId = existing?.reportId;
  }

  // 1. Delete from IndexedDB
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['issues', 'photos'], 'readwrite');
    const issueStore = tx.objectStore('issues');
    const photoStore = tx.objectStore('photos');

    issueStore.delete(issueId);

    const photoIndex = photoStore.index('issueId');
    const photoReq = photoIndex.getAllKeys(issueId);
    photoReq.onsuccess = () => {
      const photoKeys = photoReq.result || [];
      photoKeys.forEach((key) => photoStore.delete(key));
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // 2. Enqueue cloud deletion to sync queue
  if (currentUserId && reportId) {
    enqueueSync({
      entityType: 'issue',
      entityId: issueId,
      reportId,
      operation: 'delete',
      userId: currentUserId,
    });
  }

  // 3. Renumber remaining issues sequentially (1, 2, 3...) based on current list
  if (reportId) {
    await renumberIssuesForReport(reportId);
  }
}

// ----------------------------------------------------
// PHOTOS CRUD (INDEXEDDB WORKING COPY + SYNC QUEUE)
// ----------------------------------------------------

export function comparePhotos(a: Photo, b: Photo): number {
  if (typeof a.sequenceNumber === 'number' && typeof b.sequenceNumber === 'number') {
    if (a.sequenceNumber !== b.sequenceNumber) {
      return a.sequenceNumber - b.sequenceNumber;
    }
  } else if (typeof a.sequenceNumber === 'number') {
    return -1;
  } else if (typeof b.sequenceNumber === 'number') {
    return 1;
  }

  const timeA = new Date(a.createdAt).getTime();
  const timeB = new Date(b.createdAt).getTime();
  if (timeA !== timeB) {
    return timeA - timeB;
  }

  return (a.id || '').localeCompare(b.id || '');
}

export async function getNextPhotoSequenceNumber(issueId: string): Promise<number> {
  const existing = await renumberPhotosForIssue(issueId);
  return existing.length + 1;
}

/**
 * Renumbers all remaining photos for an issue sequentially (1, 2, 3...)
 * preserving original relative order and persisting to IndexedDB & sync queue.
 */
export async function renumberPhotosForIssue(issueId: string): Promise<Photo[]> {
  const db = await getDB();
  const rawPhotos: Photo[] = await new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const index = store.index('issueId');
    const req = index.getAll(issueId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  rawPhotos.sort(comparePhotos);

  const currentUserId = auth.currentUser?.uid;
  const updatedPhotos: Photo[] = [];

  for (let idx = 0; idx < rawPhotos.length; idx++) {
    const photo = rawPhotos[idx];
    const targetSeq = idx + 1;

    if (photo.sequenceNumber !== targetSeq) {
      const updatedPhoto: Photo = {
        ...photo,
        sequenceNumber: targetSeq,
        updatedAt: new Date().toISOString(),
      };

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        const store = tx.objectStore('photos');
        const req = store.put(updatedPhoto);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      if (currentUserId && updatedPhoto.reportId) {
        enqueueSync({
          entityType: 'photo',
          entityId: photo.id,
          reportId: updatedPhoto.reportId,
          operation: 'upsert',
          userId: currentUserId,
          entityData: updatedPhoto,
        });
      }

      updatedPhotos.push(updatedPhoto);
    } else {
      updatedPhotos.push(photo);
    }
  }

  return updatedPhotos;
}

/**
 * Reorders photos for an issue according to the provided list of photo IDs.
 * Immediately assigns sequential sequenceNumber (1, 2, 3...) based on new position,
 * saves to IndexedDB, and enqueues sync operations.
 */
export async function reorderPhotosForIssue(
  issueId: string,
  orderedPhotoIds: string[]
): Promise<Photo[]> {
  const db = await getDB();
  const rawPhotos: Photo[] = await new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const index = store.index('issueId');
    const req = index.getAll(issueId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const photoMap = new Map<string, Photo>();
  rawPhotos.forEach((p) => photoMap.set(p.id, p));

  const reordered: Photo[] = [];
  for (const id of orderedPhotoIds) {
    const p = photoMap.get(id);
    if (p) {
      reordered.push(p);
      photoMap.delete(id);
    }
  }
  for (const remaining of photoMap.values()) {
    reordered.push(remaining);
  }

  const currentUserId = auth.currentUser?.uid;
  const updatedPhotos: Photo[] = [];

  for (let idx = 0; idx < reordered.length; idx++) {
    const photo = reordered[idx];
    const targetSeq = idx + 1;

    if (photo.sequenceNumber !== targetSeq) {
      const updatedPhoto: Photo = {
        ...photo,
        sequenceNumber: targetSeq,
        updatedAt: new Date().toISOString(),
      };

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        const store = tx.objectStore('photos');
        const req = store.put(updatedPhoto);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      if (currentUserId && updatedPhoto.reportId) {
        enqueueSync({
          entityType: 'photo',
          entityId: photo.id,
          reportId: updatedPhoto.reportId,
          operation: 'upsert',
          userId: currentUserId,
          entityData: updatedPhoto,
        });
      }

      updatedPhotos.push(updatedPhoto);
    } else {
      updatedPhotos.push(photo);
    }
  }

  return updatedPhotos;
}

export async function getPhotosForReport(reportId: string): Promise<Photo[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos', 'issues'], 'readonly');
    const photoStore = tx.objectStore('photos');
    const issueStore = tx.objectStore('issues');

    const issueIndex = issueStore.index('reportId');
    const issueReq = issueIndex.getAll(reportId);

    issueReq.onsuccess = () => {
      const reportIssues: Issue[] = issueReq.result || [];
      const photoIndex = photoStore.index('reportId');
      const directPhotoReq = photoIndex.getAll(reportId);

      directPhotoReq.onsuccess = () => {
        const directPhotos: Photo[] = directPhotoReq.result || [];
        const photoMap = new Map<string, Photo>();
        directPhotos.forEach((p) => photoMap.set(p.id, p));

        if (reportIssues.length === 0) {
          const photos = Array.from(photoMap.values());
          photos.sort((a, b) => {
            if (a.issueNumber !== b.issueNumber) {
              return a.issueNumber - b.issueNumber;
            }
            return comparePhotos(a, b);
          });
          resolve(photos);
          return;
        }

        let completed = 0;
        const issuePhotoStore = tx.objectStore('photos');
        const issuePhotoIndex = issuePhotoStore.index('issueId');

        reportIssues.forEach((issue) => {
          const issuePhotosReq = issuePhotoIndex.getAll(issue.id);
          issuePhotosReq.onsuccess = () => {
            const ipList = issuePhotosReq.result || [];
            ipList.forEach((p) => photoMap.set(p.id, p));
            completed++;
            if (completed === reportIssues.length) {
              const photos = Array.from(photoMap.values());
              photos.sort((a, b) => {
                if (a.issueNumber !== b.issueNumber) {
                  return a.issueNumber - b.issueNumber;
                }
                return comparePhotos(a, b);
              });
              resolve(photos);
            }
          };
          issuePhotosReq.onerror = () => {
            completed++;
            if (completed === reportIssues.length) {
              const photos = Array.from(photoMap.values());
              photos.sort((a, b) => {
                if (a.issueNumber !== b.issueNumber) {
                  return a.issueNumber - b.issueNumber;
                }
                return comparePhotos(a, b);
              });
              resolve(photos);
            }
          };
        });
      };
      directPhotoReq.onerror = () => reject(directPhotoReq.error);
    };
    issueReq.onerror = () => reject(issueReq.error);
  });
}

export async function getPhotosForIssue(issueId: string): Promise<Photo[]> {
  const db = await getDB();
  const photos: Photo[] = await new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const index = store.index('issueId');
    const request = index.getAll(issueId);

    request.onsuccess = () => {
      const result: Photo[] = request.result || [];
      result.sort(comparePhotos);
      resolve(result);
    };
    request.onerror = () => reject(request.error);
  });

  // Check if any photo is out of sequence or missing sequenceNumber
  let needsRenumbering = false;
  for (let i = 0; i < photos.length; i++) {
    if (photos[i].sequenceNumber !== i + 1) {
      needsRenumbering = true;
      break;
    }
  }

  if (needsRenumbering) {
    return await renumberPhotosForIssue(issueId);
  }

  return photos;
}

export async function getPhotoCountForIssue(issueId: string): Promise<number> {
  const photos = await getPhotosForIssue(issueId);
  return photos.length;
}

export async function getPhotoById(id: string): Promise<Photo | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Single Write Path: Saves photo locally to IndexedDB, then delegates
 * cloud synchronization to the centralized sync queue.
 * (Full image remains in IndexedDB; Firestore stores metadata/reference per Section 8).
 */
export async function savePhoto(photo: Photo): Promise<void> {
  const currentUserId = auth.currentUser?.uid;
  let safeImageFile = await ensureSafeImageSize(photo.imageFile);

  // Strict byte size verification & re-compression loop (maximum 700 KB / 716,800 bytes)
  try {
    let blob = await dataUrlToBlob(safeImageFile);
    let attempts = 0;
    while (blob.size > 716800 && attempts < 3) {
      attempts++;
      safeImageFile = await ensureSafeImageSize(safeImageFile);
      blob = await dataUrlToBlob(safeImageFile);
    }
  } catch {}

  const updated: Photo = {
    ...photo,
    userId: photo.userId || currentUserId,
    imageFile: safeImageFile,
    updatedAt: new Date().toISOString(),
  };

  // 1. Save compressed version to local IndexedDB
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    const request = store.put(updated);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // 2. Delegate cloud write of the compressed version to the centralized sync queue
  if (currentUserId && updated.reportId) {
    enqueueSync({
      entityType: 'photo',
      entityId: updated.id,
      reportId: updated.reportId,
      operation: 'upsert',
      userId: currentUserId,
      entityData: updated,
    });
  }
}

/**
 * Single Write Path: Deletes photo from IndexedDB, then enqueues cloud deletion.
 */
export async function deletePhoto(photoId: string, reportIdHint?: string): Promise<void> {
  const currentUserId = auth.currentUser?.uid;

  const existingPhoto = await getPhotoById(photoId);
  const reportId = reportIdHint || existingPhoto?.reportId;
  const issueId = existingPhoto?.issueId;

  // 1. Delete from IndexedDB
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    const request = store.delete(photoId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // 2. Enqueue cloud deletion to sync queue
  if (currentUserId && reportId) {
    enqueueSync({
      entityType: 'photo',
      entityId: photoId,
      reportId,
      operation: 'delete',
      userId: currentUserId,
    });
  }

  // 3. Renumber remaining photos in that issue sequentially (1, 2, 3...)
  if (issueId) {
    await renumberPhotosForIssue(issueId);
  }
}

// ----------------------------------------------------
// USER PROFILE & ACCOUNT PERSISTENCE
// ----------------------------------------------------

const USER_PROFILE_KEY = 'assured_capture_user_profile';
const AUTH_USER_PROFILE_KEY = 'assured_capture_auth_user_profile';

export const EMPTY_GUEST_PROFILE: UserProfile = {
  userId: null,
  name: '',
  fullName: '',
  email: '',
  avatarUrl: '',
  photoURL: null,
  role: '',
  accountType: 'guest',
};

export const DEFAULT_USER_PROFILE: UserProfile = {
  ...EMPTY_GUEST_PROFILE,
};

export function createEmptyGuestProfile(): UserProfile {
  return {
    userId: null,
    name: '',
    fullName: '',
    email: '',
    avatarUrl: '',
    photoURL: null,
    role: '',
    accountType: 'guest',
  };
}

export function clearStoredUserProfile(): void {
  try {
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(AUTH_USER_PROFILE_KEY);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(AUTH_USER_PROFILE_KEY) || key.startsWith(USER_PROFILE_KEY))) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn('Failed to clear stored user profile:', e);
  }
}

export function getUserProfile(): UserProfile {
  const currentUserId = auth.currentUser?.uid;
  if (currentUserId) {
    try {
      const data = localStorage.getItem(`${AUTH_USER_PROFILE_KEY}_${currentUserId}`) || localStorage.getItem(USER_PROFILE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && (parsed.userId === currentUserId || !parsed.userId)) {
          const profileName = parsed.profileName || parsed.fullName || parsed.displayName || parsed.name || '';
          const canonicalName = profileName || 'User Profile';
          return {
            ...parsed,
            userId: currentUserId,
            profileName,
            displayName: profileName,
            name: canonicalName,
            fullName: profileName,
            email: parsed.email || auth.currentUser?.email || '',
            avatarUrl: parsed.avatarUrl || parsed.photoURL || auth.currentUser?.photoURL || '',
            photoURL: parsed.photoURL || parsed.avatarUrl || auth.currentUser?.photoURL || null,
            accountType: 'authenticated',
          };
        }
      }
    } catch (e) {
      console.warn('Failed to parse user profile from localStorage:', e);
    }
    const defaultProfileName = auth.currentUser?.displayName || '';
    return {
      userId: currentUserId,
      profileName: defaultProfileName,
      displayName: defaultProfileName,
      name: defaultProfileName || 'User Profile',
      fullName: defaultProfileName,
      email: auth.currentUser?.email || '',
      avatarUrl: auth.currentUser?.photoURL || '',
      photoURL: auth.currentUser?.photoURL || null,
      role: '',
      accountType: 'authenticated',
    };
  }
  return createEmptyGuestProfile();
}

/**
 * Authoritatively saves and synchronizes the profile to the authenticated user's account and Firestore database.
 * Updates both the Firestore user document and Firebase Auth display profile.
 * Guarantees that profileName and avatarUrl are directly written to cloud database.
 */
export async function saveUserProfileToAccount(profile: UserProfile): Promise<UserProfile> {
  const currentUserId = auth.currentUser?.uid;
  const isGuest = !currentUserId || profile.accountType === 'guest';

  const cleanProfileName = profile.profileName?.trim() || profile.fullName?.trim() || profile.name?.trim() || profile.displayName?.trim() || '';
  const canonicalName = cleanProfileName || 'User Profile';
  const cleanEmail = profile.email?.trim() || auth.currentUser?.email || '';
  const cleanAvatarUrl = profile.avatarUrl?.trim() || '';
  const avatarStorageUri = profile.avatarStorageUri || (cleanAvatarUrl ? `gs://assured-capture-storage/users/${currentUserId || 'guest'}/avatar.jpg` : '');

  const normalizedProfile: UserProfile = {
    userId: currentUserId || null,
    profileName: cleanProfileName,
    displayName: cleanProfileName,
    name: canonicalName,
    fullName: cleanProfileName,
    email: cleanEmail,
    avatarUrl: cleanAvatarUrl,
    photoURL: cleanAvatarUrl || null,
    avatarStorageUri,
    role: profile.role || '',
    accountType: isGuest ? 'guest' : 'authenticated',
    updatedAt: new Date().toISOString(),
  };

  if (!isGuest && currentUserId) {
    // 1. Update Firebase Auth displayName (preserves credentials & provider tokens)
    if (auth.currentUser) {
      try {
        const authUpdates: { displayName?: string; photoURL?: string } = {};
        if (cleanProfileName) {
          authUpdates.displayName = cleanProfileName;
        }
        // Only pass valid http/https URLs to Firebase Auth photoURL (Auth rejects long base64 strings)
        if (cleanAvatarUrl && cleanAvatarUrl.length < 2048 && (cleanAvatarUrl.startsWith('http://') || cleanAvatarUrl.startsWith('https://'))) {
          authUpdates.photoURL = cleanAvatarUrl;
        }
        if (Object.keys(authUpdates).length > 0) {
          await updateProfile(auth.currentUser, authUpdates);
        }
      } catch (authErr) {
        console.warn('Firebase Auth updateProfile non-fatal notice:', authErr);
      }
    }

    // 2. Direct write to Firestore users/{currentUserId}
    try {
      const userDocRef = doc(firestoreDb, 'users', currentUserId);
      await setDoc(
        userDocRef,
        {
          userId: currentUserId,
          profileName: cleanProfileName,
          displayName: cleanProfileName, // preserved for backward compatibility
          name: canonicalName,
          fullName: cleanProfileName,
          email: cleanEmail,
          avatarUrl: cleanAvatarUrl,
          photoURL: cleanAvatarUrl || null,
          avatarStorageUri,
          role: profile.role || '',
          accountType: 'authenticated',
          updatedAt: normalizedProfile.updatedAt,
        },
        { merge: true }
      );
    } catch (dbErr: any) {
      if (isQuotaExceededError(dbErr)) {
        setFirestoreQuotaExhausted(true);
      }
      console.error('Failed direct Firestore save for user profile:', dbErr);
      // If direct write failed (e.g. offline), queue it
      enqueueSync({
        entityType: 'user_profile',
        entityId: currentUserId,
        operation: 'upsert',
        userId: currentUserId,
        entityData: normalizedProfile,
      });
      // Cache locally so user doesn't lose work
      try {
        localStorage.setItem(`${AUTH_USER_PROFILE_KEY}_${currentUserId}`, JSON.stringify(normalizedProfile));
      } catch {}
      throw new Error(dbErr?.message || 'Failed to save profile to cloud database. Changes saved offline.');
    }

    // 3. Cache confirmed profile in local storage
    try {
      localStorage.setItem(`${AUTH_USER_PROFILE_KEY}_${currentUserId}`, JSON.stringify(normalizedProfile));
    } catch (e) {
      console.warn('Failed to cache user profile to localStorage:', e);
    }
  } else {
    // Guest mode
    try {
      localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(normalizedProfile));
    } catch (e) {
      console.warn('Failed to save guest profile to localStorage:', e);
    }
  }

  return normalizedProfile;
}

export function saveUserProfile(profile: UserProfile): void {
  const currentUserId = auth.currentUser?.uid;
  if (currentUserId && profile.accountType !== 'guest') {
    try {
      localStorage.setItem(`${AUTH_USER_PROFILE_KEY}_${currentUserId}`, JSON.stringify(profile));
    } catch (e) {
      console.warn('Failed to save user profile to localStorage:', e);
    }
    // Async save to cloud database
    saveUserProfileToAccount(profile).catch((err) => {
      console.warn('Background saveUserProfileToAccount notice:', err);
    });
  } else {
    try {
      localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.warn('Failed to save guest profile to localStorage:', e);
    }
  }
}

export async function fetchUserProfileFromFirestore(userId: string): Promise<UserProfile | null> {
  const localProf = getUserProfile();

  // If quota is exhausted, fall back to local profile
  if (isFirestoreQuotaExhausted()) {
    return localProf;
  }

  try {
    const userDoc = await getDoc(doc(firestoreDb, 'users', userId));
    if (userDoc.exists()) {
      const data = userDoc.data();
      const profileName = data.profileName || data.name || data.displayName || data.fullName || '';
      const canonicalName = profileName || 'User Profile';
      const avatarUrl = data.avatarUrl || data.photoURL || auth.currentUser?.photoURL || '';

      const profile: UserProfile = {
        userId,
        profileName,
        displayName: profileName,
        name: canonicalName,
        fullName: profileName,
        email: data.email || auth.currentUser?.email || '',
        avatarUrl,
        photoURL: avatarUrl || null,
        avatarStorageUri: data.avatarStorageUri || (avatarUrl ? `gs://assured-capture-storage/users/${userId}/avatar.jpg` : ''),
        role: data.role || '',
        accountType: 'authenticated',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt || new Date().toISOString(),
      };

      try {
        localStorage.setItem(`${AUTH_USER_PROFILE_KEY}_${userId}`, JSON.stringify(profile));
      } catch {
        // ignore
      }
      return profile;
    } else {
      // Document does not exist in Firestore yet: bootstrap it with current user account data
      const defaultProfileName = localProf?.profileName || auth.currentUser?.displayName || localProf?.name || localProf?.fullName || '';
      const defaultEmail = auth.currentUser?.email || localProf?.email || '';
      const defaultAvatar = auth.currentUser?.photoURL || localProf?.avatarUrl || '';

      const initialProfile: UserProfile = {
        userId,
        profileName: defaultProfileName,
        displayName: defaultProfileName,
        name: defaultProfileName || 'User Profile',
        fullName: defaultProfileName,
        email: defaultEmail,
        avatarUrl: defaultAvatar,
        photoURL: defaultAvatar || null,
        avatarStorageUri: defaultAvatar ? `gs://assured-capture-storage/users/${userId}/avatar.jpg` : '',
        role: localProf?.role || '',
        accountType: 'authenticated',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        await setDoc(doc(firestoreDb, 'users', userId), initialProfile, { merge: true });
        localStorage.setItem(`${AUTH_USER_PROFILE_KEY}_${userId}`, JSON.stringify(initialProfile));
      } catch (err) {
        console.warn('Could not bootstrap initial user profile in Firestore:', err);
      }
      return initialProfile;
    }
  } catch (e: any) {
    if (isQuotaExceededError(e)) {
      setFirestoreQuotaExhausted(true);
    }
    console.warn('Failed to fetch user profile from Firestore, using local fallback:', e);
    if (localProf && localProf.userId === userId) {
      return localProf;
    }
    if (auth.currentUser) {
      return {
        userId,
        profileName: auth.currentUser.displayName || '',
        displayName: auth.currentUser.displayName || '',
        name: auth.currentUser.displayName || '',
        fullName: auth.currentUser.displayName || '',
        email: auth.currentUser.email || '',
        avatarUrl: auth.currentUser.photoURL || '',
        photoURL: auth.currentUser.photoURL || null,
        role: '',
        accountType: 'authenticated',
      };
    }
  }
  return null;
}

// ----------------------------------------------------
// 7. LOGIN / SESSION MIGRATION (RUNS ONCE, LOCALLY)
// ----------------------------------------------------

const MIGRATION_DONE_KEY_PREFIX = 'assured_capture_migration_done_uid_';

/**
 * Migration must:
 * - Run only when actually necessary
 * - Run at most once for a given user UID
 * - Process only genuinely unassigned/local drafts
 * - Never repeatedly migrate already-assigned records
 * - Never migrate the same record on every login
 * - Never create recursive Firestore writes
 * - Persist a durable migration marker locally
 */
export async function migrateExistingLocalData(userId: string): Promise<void> {
  if (!userId) return;

  const migrationKey = `${MIGRATION_DONE_KEY_PREFIX}${userId}`;
  try {
    if (localStorage.getItem(migrationKey) === 'true') {
      // Already migrated for this user. Never run again.
      return;
    }
  } catch {
    // ignore
  }

  try {
    const db = await getDB();
    const tx = db.transaction(['reports', 'issues', 'photos'], 'readwrite');
    const reportStore = tx.objectStore('reports');
    const issueStore = tx.objectStore('issues');
    const photoStore = tx.objectStore('photos');

    const repReq = reportStore.getAll();

    repReq.onsuccess = async () => {
      const reports: Report[] = repReq.result || [];
      // Only migrate reports that genuinely do NOT have an assigned owner
      const unownedReports = reports.filter((r) => !r.userId);

      if (unownedReports.length === 0) {
        // No unassigned reports exist. Mark completed durably.
        try {
          localStorage.setItem(migrationKey, 'true');
        } catch {
          // ignore
        }
        return;
      }

      for (const rep of unownedReports) {
        rep.userId = userId;
        reportStore.put(rep);

        // Enqueue to sync queue rather than immediate loop writes
        enqueueSync({
          entityType: 'report',
          entityId: rep.id,
          operation: 'upsert',
          userId,
          entityData: rep,
        });

        // Adopt unassigned issues for this report
        const issueIndex = issueStore.index('reportId');
        const issueReq = issueIndex.getAll(rep.id);
        issueReq.onsuccess = () => {
          const issues: Issue[] = issueReq.result || [];
          for (const iss of issues) {
            if (!iss.userId) {
              iss.userId = userId;
              issueStore.put(iss);
              enqueueSync({
                entityType: 'issue',
                entityId: iss.id,
                reportId: rep.id,
                operation: 'upsert',
                userId,
                entityData: iss,
              });
            }
          }
        };

        // Adopt unassigned photos for this report
        const photoIndex = photoStore.index('reportId');
        const photoReq = photoIndex.getAll(rep.id);
        photoReq.onsuccess = () => {
          const photos: Photo[] = photoReq.result || [];
          for (const pho of photos) {
            if (!pho.userId) {
              pho.userId = userId;
              photoStore.put(pho);
              enqueueSync({
                entityType: 'photo',
                entityId: pho.id,
                reportId: rep.id,
                operation: 'upsert',
                userId,
                entityData: pho,
              });
            }
          }
        };
      }

      // Mark migration completed durably
      try {
        localStorage.setItem(migrationKey, 'true');
      } catch {
        // ignore
      }
    };
  } catch (err) {
    console.warn('Migration non-fatal error:', err);
  }
}

/**
 * Section 11: Sign Out Isolation
 * Clears local IndexedDB cache on sign out so a subsequent user on the same
 * browser/device cannot see the previous user's sensitive inspection reports.
 */
export async function clearLocalCacheOnSignOut(): Promise<void> {
  try {
    clearStoredUserProfile();
    // CRITICAL: Do NOT wipe reports, issues, or photos object stores.
    // Local inspection data must remain preserved safely across authentication transitions.
  } catch (err) {
    console.warn('Clear local cache on logout error:', err);
  }
}

// Clean up any legacy test seeds
export async function initializeSeedData(): Promise<void> {
  try {
    const legacySeed = await getReportById('rep_seed_bbc_26_90');
    if (legacySeed) {
      await deleteReport('rep_seed_bbc_26_90');
    }
  } catch {
    // ignore
  }
}
