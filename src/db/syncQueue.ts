import { auth, db as firestoreDb } from '../utils/firebaseAuth';
import {
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { getDB, isQuotaExceededError, setFirestoreQuotaExhausted, isFirestoreQuotaExhausted, ensureSafeImageSize, dataUrlToBlob } from './storage';
import { Report, Issue, Photo, UserProfile } from '../types';

export interface SyncQueueItem {
  id: string; // `${entityType}_${entityId}`
  entityType: 'report' | 'issue' | 'photo' | 'user_profile';
  entityId: string;
  operation: 'upsert' | 'delete';
  userId: string;
  reportId?: string;
  dataHash: string;
  localTimestamp: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'paused_quota';
  retryCount: number;
  lastAttemptAt?: number;
  lastError?: string;
}

// ----------------------------------------------------
// 11. TEST INSTRUMENTATION (DEV / TEST MODE LOGGING)
// ----------------------------------------------------

export interface FirestoreWriteLogEntry {
  operation: 'setDoc' | 'deleteDoc' | 'writeBatch';
  path: string;
  source: 'sync_queue' | 'explicit_save' | 'migration' | 'manual_sync';
  uid: string;
  dataChanged: boolean;
  entityType?: string;
  details?: string;
  timestamp: string;
}

const WRITE_LOGS_KEY = 'assured_capture_firestore_write_logs';
const MAX_IN_MEMORY_LOGS = 50;
const inMemoryLogs: FirestoreWriteLogEntry[] = [];

export function logFirestoreWrite(entry: Omit<FirestoreWriteLogEntry, 'timestamp'>): void {
  const fullEntry: FirestoreWriteLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  inMemoryLogs.push(fullEntry);
  if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryLogs.shift();
  }

  // Lightweight logging in development / testing mode only
  // Sensitive tokens, passwords, and private image data are strictly excluded
  if (import.meta.env.DEV || (typeof window !== 'undefined' && (window as any).__ENABLE_FIRESTORE_AUDIT__)) {
    console.info(
      `%c[Firestore Audit] WRITE ${fullEntry.operation} | ${fullEntry.path} | source: ${fullEntry.source} | changed: ${fullEntry.dataChanged} | uid: ${fullEntry.uid.slice(0, 8)}...`,
      'color: #0E7490; font-weight: bold;'
    );
  }
}

export function getRecentFirestoreWriteLogs(): FirestoreWriteLogEntry[] {
  return [...inMemoryLogs];
}

// ----------------------------------------------------
// ENTITY HASHING FOR DEDUPLICATION & CHANGE DETECTION
// ----------------------------------------------------

export function computeEntityHash(entity: any, type: SyncQueueItem['entityType']): string {
  if (!entity) return '';
  try {
    let rawStr = '';
    if (type === 'report') {
      const r = entity as Report;
      const imgSig = r.reportImage
        ? `${r.reportImage.length}_${r.reportImage.slice(0, 30)}_${r.reportImage.slice(-30)}`
        : 'empty';
      rawStr = `${r.id}|${r.jobReference}|${r.reportName}|${r.clientName}|${r.address}|${r.reportDate}|${r.status}|${r.inspectionDate}|${r.highestIssueNumberAssigned || 0}|${imgSig}`;
    } else if (type === 'issue') {
      const i = entity as Issue;
      rawStr = `${i.id}|${i.reportId}|${i.issueNumber}|${i.issueName || ''}|${i.issueDescription || ''}|${i.notes || ''}|${(i as any).category || ''}`;
    } else if (type === 'photo') {
      const p = entity as Photo;
      const imgSig = p.imageFile
        ? `${p.imageFile.length}_${p.imageFile.slice(0, 30)}_${p.imageFile.slice(-30)}`
        : 'empty';
      rawStr = `${p.id}|${p.reportId}|${p.issueId}|${p.sequenceNumber || 0}|${p.description || ''}|${p.isReferenceImage ? 1 : 0}|${p.internalNotes || ''}|${p.includeInReport !== false ? 1 : 0}|${imgSig}`;
    } else if (type === 'user_profile') {
      const u = entity as UserProfile;
      rawStr = `${u.userId}|${u.name || ''}|${u.fullName || ''}|${u.email || ''}|${u.role || ''}|${u.avatarUrl || ''}`;
    } else {
      rawStr = JSON.stringify(entity);
    }

    // Fast simple 32-bit hash
    let hash = 0;
    for (let i = 0; i < rawStr.length; i++) {
      hash = (hash << 5) - hash + rawStr.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  } catch {
    return String(Date.now());
  }
}

// Durable map of entityKey -> lastSyncedHash to avoid writing unchanged data
const SYNCED_HASH_KEY = 'assured_capture_last_synced_hashes';

function getSyncedHashes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SYNCED_HASH_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setSyncedHash(key: string, hash: string): void {
  try {
    const hashes = getSyncedHashes();
    hashes[key] = hash;
    // Cap stored hash map size to prevent unbounded growth
    const keys = Object.keys(hashes);
    if (keys.length > 500) {
      delete hashes[keys[0]];
    }
    localStorage.setItem(SYNCED_HASH_KEY, JSON.stringify(hashes));
  } catch {
    // ignore
  }
}

function removeSyncedHash(key: string): void {
  try {
    const hashes = getSyncedHashes();
    delete hashes[key];
    localStorage.setItem(SYNCED_HASH_KEY, JSON.stringify(hashes));
  } catch {
    // ignore
  }
}

// ----------------------------------------------------
// SYNC QUEUE MANAGEMENT (INDEXEDDB BACKED)
// ----------------------------------------------------

let syncDebounceTimer: any = null;
let isProcessingQueue = false;

/**
 * Enqueue a sync job. Coalesces duplicate writes for the same entity
 * into a single pending update.
 */
export async function enqueueSync(params: {
  entityType: SyncQueueItem['entityType'];
  entityId: string;
  operation: 'upsert' | 'delete';
  userId: string;
  reportId?: string;
  entityData?: any;
}): Promise<void> {
  const currentUid = auth.currentUser?.uid;
  // Guest mode or unauthenticated data must NEVER be enqueued for cloud sync
  if (!params.userId || !currentUid || params.userId !== currentUid) {
    return;
  }

  const queueItemId = `${params.entityType}_${params.entityId}`;
  const dataHash = params.operation === 'upsert' ? computeEntityHash(params.entityData, params.entityType) : 'DELETED';

  // Check if unchanged data is already synced
  if (params.operation === 'upsert') {
    const lastHash = getSyncedHashes()[queueItemId];
    if (lastHash && lastHash === dataHash) {
      // Data is identical to what is already on Firestore. Suppress write.
      if (import.meta.env.DEV) {
        console.debug(`[SyncQueue] Suppressed redundant write for ${queueItemId} (data unchanged)`);
      }
      return;
    }
  }

  const queueItem: SyncQueueItem = {
    id: queueItemId,
    entityType: params.entityType,
    entityId: params.entityId,
    operation: params.operation,
    userId: params.userId,
    reportId: params.reportId,
    dataHash,
    localTimestamp: Date.now(),
    status: 'pending',
    retryCount: 0,
  };

  try {
    const db = await getDB();
    if (db.objectStoreNames.contains('syncQueue')) {
      const tx = db.transaction('syncQueue', 'readwrite');
      tx.objectStore('syncQueue').put(queueItem);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      notifyPendingCountChanged();
    }
  } catch (err) {
    console.warn('[SyncQueue] Non-fatal queue persistence error:', err);
  }

  // Trigger debounced synchronization processing
  scheduleSyncQueueProcessing(1200);
}

/**
 * Debounced trigger for sync queue processing
 */
export function scheduleSyncQueueProcessing(delayMs: number = 1000): void {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }
  syncDebounceTimer = setTimeout(() => {
    processSyncQueue().catch((err) => {
      console.warn('[SyncQueue] Background processing error:', err);
    });
  }, delayMs);
}

/**
 * Core synchronization queue worker.
 * Checks authentication, quota limits, coalesces items, and executes safe writes.
 */
export async function processSyncQueue(): Promise<{
  processedCount: number;
  successCount: number;
  skippedCount: number;
  quotaPaused: boolean;
}> {
  if (isProcessingQueue) {
    return { processedCount: 0, successCount: 0, skippedCount: 0, quotaPaused: false };
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    // No user signed in: sync queue remains dormant
    return { processedCount: 0, successCount: 0, skippedCount: 0, quotaPaused: false };
  }

  // Quota enforcement: do not run sync if in quota exhausted state
  if (isFirestoreQuotaExhausted()) {
    return { processedCount: 0, successCount: 0, skippedCount: 0, quotaPaused: true };
  }

  // Network connectivity check: do not attempt cloud sync if currently offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { processedCount: 0, successCount: 0, skippedCount: 0, quotaPaused: false };
  }

  isProcessingQueue = true;
  let processedCount = 0;
  let successCount = 0;
  let skippedCount = 0;
  let quotaPaused = false;

  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('syncQueue')) {
      isProcessingQueue = false;
      return { processedCount: 0, successCount: 0, skippedCount: 0, quotaPaused: false };
    }

    // Retrieve pending queue items for current user
    const items: SyncQueueItem[] = await new Promise((resolve) => {
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      const req = store.getAll();
      req.onsuccess = () => {
        const all: SyncQueueItem[] = req.result || [];
        const priorityOrder: Record<string, number> = {
          report: 1,
          issue: 2,
          photo: 3,
          user_profile: 4,
        };
        const userItems = all
          .filter((i) => i.userId === currentUser.uid && i.status !== 'synced')
          .sort((a, b) => {
            if (a.operation === 'delete' || b.operation === 'delete') {
              if (a.operation !== b.operation) {
                return a.operation === 'delete' ? -1 : 1;
              }
              const pA = priorityOrder[a.entityType] || 99;
              const pB = priorityOrder[b.entityType] || 99;
              if (pA !== pB) return pB - pA;
              return a.localTimestamp - b.localTimestamp;
            }
            const pA = priorityOrder[a.entityType] || 99;
            const pB = priorityOrder[b.entityType] || 99;
            if (pA !== pB) return pA - pB;
            return a.localTimestamp - b.localTimestamp;
          });
        resolve(userItems);
      };
      req.onerror = () => resolve([]);
    });

    if (items.length === 0) {
      isProcessingQueue = false;
      return { processedCount: 0, successCount: 0, skippedCount: 0, quotaPaused: false };
    }

    for (const item of items) {
      // Re-verify quota before each write
      if (isFirestoreQuotaExhausted()) {
        quotaPaused = true;
        break;
      }

      processedCount++;

      try {
        if (item.operation === 'delete') {
          await executeDeleteSync(item, currentUser.uid);
          removeSyncedHash(item.id);
          await removeQueueItem(item.id);
          successCount++;
        } else {
          // Upsert: fetch current state from local IndexedDB
          const currentEntity = await fetchLocalEntity(item.entityType, item.entityId);
          if (!currentEntity) {
            // Entity was removed locally in the meantime: delete from queue
            await removeQueueItem(item.id);
            skippedCount++;
            continue;
          }

          // Double-check if data actually changed
          const currentHash = computeEntityHash(currentEntity, item.entityType);
          const lastSynced = getSyncedHashes()[item.id];
          if (lastSynced === currentHash) {
            // Data has not changed since last cloud write. Skip network write!
            await removeQueueItem(item.id);
            skippedCount++;
            continue;
          }

          // Execute single write to Firestore
          await executeUpsertSync(item, currentEntity, currentUser.uid, currentHash);
          setSyncedHash(item.id, currentHash);
          await removeQueueItem(item.id);
          successCount++;
        }
      } catch (err: any) {
        if (isQuotaExceededError(err)) {
          console.warn('[SyncQueue] Cloud write quota reached. Entering Local Storage Mode.');
          setFirestoreQuotaExhausted(true);
          await updateQueueItemStatus(item.id, 'paused_quota', 'Daily cloud write quota reached');
          quotaPaused = true;
          // Halt queue processing immediately on quota exhaustion. No retry storms!
          break;
        } else {
          console.warn(`[SyncQueue] Failed sync for ${item.id}:`, err);
          const nextRetry = (item.retryCount || 0) + 1;
          const status = nextRetry >= 3 ? 'failed' : 'pending';
          await updateQueueItemStatus(item.id, status, err?.message || 'Write failed');
        }
      }
    }
  } finally {
    isProcessingQueue = false;
    notifyPendingCountChanged();
  }

  return { processedCount, successCount, skippedCount, quotaPaused };
}

/**
 * Utility to strip undefined properties from an object so Firestore setDoc never encounters
 * "Unsupported field value: undefined".
 */
export function removeUndefinedFields<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// ----------------------------------------------------
// FIRESTORE DISPATCHERS (TARGETED, CLEANED WRITES)
// ----------------------------------------------------

async function executeUpsertSync(
  item: SyncQueueItem,
  entity: any,
  uid: string,
  dataHash: string
): Promise<void> {
  if (item.entityType === 'report') {
    const rep = entity as Report;
    const cleanedReport: Record<string, any> = {
      id: rep.id,
      userId: uid,
      jobReference: rep.jobReference || '',
      reportName: rep.reportName || '',
      clientName: rep.clientName || '',
      address: rep.address || '',
      reportDate: rep.reportDate || '',
      status: rep.status || 'Draft',
      inspectionDate: rep.inspectionDate || '',
      inspectionDateHistory: rep.inspectionDateHistory || [],
      highestIssueNumberAssigned: rep.highestIssueNumberAssigned || 0,
      createdAt: rep.createdAt || new Date().toISOString(),
      updatedAt: rep.updatedAt || new Date().toISOString(),
    };

    // If reportImage has a valid value, include it. If undefined or empty, omit entirely.
    if (rep.reportImage) {
      cleanedReport.reportImage = rep.reportImage;
    }
    if (rep.isDeleted !== undefined) {
      cleanedReport.isDeleted = rep.isDeleted;
    }
    if (rep.deletedAt) {
      cleanedReport.deletedAt = rep.deletedAt;
    }

    const docPath = `reports/${rep.id}`;
    const docRef = doc(firestoreDb, 'reports', rep.id);
    await setDoc(docRef, removeUndefinedFields(cleanedReport), { merge: true });

    logFirestoreWrite({
      operation: 'setDoc',
      path: docPath,
      source: 'sync_queue',
      uid,
      dataChanged: true,
      entityType: 'report',
      details: rep.jobReference,
    });
  } else if (item.entityType === 'issue') {
    const iss = entity as Issue;
    const reportId = item.reportId || iss.reportId;
    if (!reportId) throw new Error('Missing reportId for issue sync');

    const cleanedIssue: Record<string, any> = {
      id: iss.id,
      reportId,
      userId: uid,
      issueNumber: iss.issueNumber ?? 1,
      issueName: iss.issueName || '',
      issueDescription: iss.issueDescription || '',
      notes: iss.notes || '',
      createdAt: iss.createdAt || new Date().toISOString(),
      updatedAt: iss.updatedAt || new Date().toISOString(),
    };
    if (iss.category) {
      cleanedIssue.category = iss.category;
    }

    const docPath = `reports/${reportId}/issues/${iss.id}`;
    const docRef = doc(firestoreDb, 'reports', reportId, 'issues', iss.id);
    await setDoc(docRef, removeUndefinedFields(cleanedIssue), { merge: true });

    logFirestoreWrite({
      operation: 'setDoc',
      path: docPath,
      source: 'sync_queue',
      uid,
      dataChanged: true,
      entityType: 'issue',
      details: `Issue #${iss.issueNumber}`,
    });
  } else if (item.entityType === 'photo') {
    let pho = entity as Photo;
    const reportId = item.reportId || pho.reportId;
    if (!reportId) throw new Error('Missing reportId for photo sync');

    // Runtime size check & re-compression for existing photo entries in queue/IndexedDB
    if (pho.imageFile) {
      let needsStorageUpdate = false;
      try {
        const blob = await dataUrlToBlob(pho.imageFile);
        if (blob.size > 716800) {
          const compressed = await ensureSafeImageSize(pho.imageFile);
          const compressedBlob = await dataUrlToBlob(compressed);
          if (compressedBlob.size <= 716800) {
            pho = { ...pho, imageFile: compressed, updatedAt: new Date().toISOString() };
            needsStorageUpdate = true;
          } else {
            // Force second pass if still above threshold
            const forced = await ensureSafeImageSize(compressed);
            pho = { ...pho, imageFile: forced, updatedAt: new Date().toISOString() };
            needsStorageUpdate = true;
          }
        }
      } catch {
        const compressed = await ensureSafeImageSize(pho.imageFile);
        pho = { ...pho, imageFile: compressed, updatedAt: new Date().toISOString() };
        needsStorageUpdate = true;
      }

      if (needsStorageUpdate) {
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('photos', 'readwrite');
          const store = tx.objectStore('photos');
          const req = store.put(pho);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
    }

    // Section 8: Store metadata and storage references rather than repeatedly rewriting massive base64 blobs
    const firestorePhotoDoc: Record<string, any> = {
      id: pho.id,
      reportId,
      issueId: pho.issueId,
      userId: uid,
      issueNumber: pho.issueNumber ?? 1,
      jobReference: pho.jobReference || '',
      sequenceNumber: pho.sequenceNumber || 1,
      description: pho.description || '',
      isReferenceImage: !!pho.isReferenceImage,
      internalNotes: pho.internalNotes || '',
      includeInReport: pho.includeInReport !== false,
      storageUri: pho.storageUri || `gs://assured-capture-storage/reports/${reportId}/photos/${pho.id}.jpg`,
      createdAt: pho.createdAt || new Date().toISOString(),
      updatedAt: pho.updatedAt || new Date().toISOString(),
      imageFile: pho.imageFile,
    };
    if (pho.textBoxAnnotations) {
      firestorePhotoDoc.textBoxAnnotations = pho.textBoxAnnotations;
    }
    if (pho.originalImageFile) {
      firestorePhotoDoc.originalImageFile = pho.originalImageFile;
    }
    if (pho.capturedAt !== undefined && pho.capturedAt !== null) {
      firestorePhotoDoc.capturedAt = pho.capturedAt;
    }

    const docPath = `reports/${reportId}/photos/${pho.id}`;
    const docRef = doc(firestoreDb, 'reports', reportId, 'photos', pho.id);
    await setDoc(docRef, removeUndefinedFields(firestorePhotoDoc), { merge: true });

    logFirestoreWrite({
      operation: 'setDoc',
      path: docPath,
      source: 'sync_queue',
      uid,
      dataChanged: true,
      entityType: 'photo',
      details: `Evidence #${pho.sequenceNumber || 1}`,
    });
  } else if (item.entityType === 'user_profile') {
    const prof = entity as UserProfile;
    const docPath = `users/${uid}`;
    const docRef = doc(firestoreDb, 'users', uid);
    const profileName = prof.profileName || prof.fullName || prof.name || '';
    const displayName = prof.displayName || prof.name || profileName || '';
    const userDoc: Record<string, any> = {
      userId: uid,
      profileName,
      displayName,
      name: displayName || profileName || prof.name || '',
      fullName: profileName || displayName || prof.fullName || '',
      email: prof.email || '',
      avatarUrl: prof.avatarUrl || prof.photoURL || '',
      photoURL: prof.photoURL || prof.avatarUrl || null,
      avatarStorageUri: prof.avatarStorageUri || (prof.avatarUrl ? `gs://assured-capture-storage/users/${uid}/avatar.jpg` : ''),
      role: prof.role || '',
      accountType: 'authenticated',
      updatedAt: new Date().toISOString(),
    };
    await setDoc(docRef, removeUndefinedFields(userDoc), { merge: true });

    logFirestoreWrite({
      operation: 'setDoc',
      path: docPath,
      source: 'sync_queue',
      uid,
      dataChanged: true,
      entityType: 'user_profile',
    });
  }
}

async function executeDeleteSync(item: SyncQueueItem, uid: string): Promise<void> {
  if (item.entityType === 'report') {
    const reportId = item.entityId;
    const batch = writeBatch(firestoreDb);

    try {
      // 1. Subcollection cleanup: delete all nested issues and photos from Firestore
      const issuesSnap = await getDocs(collection(firestoreDb, 'reports', reportId, 'issues'));
      issuesSnap.forEach((d) => batch.delete(d.ref));

      const photosSnap = await getDocs(collection(firestoreDb, 'reports', reportId, 'photos'));
      photosSnap.forEach((d) => batch.delete(d.ref));

      // 2. Mark report document with a durable tombstone so other devices observe explicit deletion
      const tombstoneDoc = {
        id: reportId,
        userId: uid,
        jobReference: '',
        reportName: '',
        status: 'Deleted',
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      batch.set(doc(firestoreDb, 'reports', reportId), tombstoneDoc);
      await batch.commit();

      logFirestoreWrite({
        operation: 'writeBatch',
        path: `reports/${reportId} (tombstone & subcollection cleanup)`,
        source: 'sync_queue',
        uid,
        dataChanged: true,
        entityType: 'report',
      });
    } catch {
      // Fallback: write single tombstone doc
      await setDoc(doc(firestoreDb, 'reports', reportId), {
        id: reportId,
        userId: uid,
        status: 'Deleted',
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  } else if (item.entityType === 'issue') {
    if (item.reportId) {
      await deleteDoc(doc(firestoreDb, 'reports', item.reportId, 'issues', item.entityId));
      logFirestoreWrite({
        operation: 'deleteDoc',
        path: `reports/${item.reportId}/issues/${item.entityId}`,
        source: 'sync_queue',
        uid,
        dataChanged: true,
        entityType: 'issue',
      });
    }
  } else if (item.entityType === 'photo') {
    if (item.reportId) {
      await deleteDoc(doc(firestoreDb, 'reports', item.reportId, 'photos', item.entityId));
      logFirestoreWrite({
        operation: 'deleteDoc',
        path: `reports/${item.reportId}/photos/${item.entityId}`,
        source: 'sync_queue',
        uid,
        dataChanged: true,
        entityType: 'photo',
      });
    }
  }
}

// ----------------------------------------------------
// LOCAL INDEXEDDB HELPERS
// ----------------------------------------------------

async function fetchLocalEntity(
  type: SyncQueueItem['entityType'],
  id: string
): Promise<any | null> {
  const db = await getDB();
  return new Promise((resolve) => {
    let storeName: 'reports' | 'issues' | 'photos' | null = null;
    if (type === 'report') storeName = 'reports';
    else if (type === 'issue') storeName = 'issues';
    else if (type === 'photo') storeName = 'photos';

    if (!storeName || !db.objectStoreNames.contains(storeName)) {
      if (type === 'user_profile') {
        try {
          const raw = localStorage.getItem(`assured_capture_auth_user_profile_${id}`);
          resolve(raw ? JSON.parse(raw) : null);
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
      return;
    }

    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function removeQueueItem(id: string): Promise<void> {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('syncQueue')) return;
    const tx = db.transaction('syncQueue', 'readwrite');
    tx.objectStore('syncQueue').delete(id);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    notifyPendingCountChanged();
  } catch {
    // non-fatal
  }
}

async function updateQueueItemStatus(
  id: string,
  status: SyncQueueItem['status'],
  errorMessage?: string
): Promise<void> {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('syncQueue')) return;
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const req = store.get(id);
    req.onsuccess = () => {
      const item: SyncQueueItem | undefined = req.result;
      if (item) {
        item.status = status;
        item.lastAttemptAt = Date.now();
        item.retryCount = (item.retryCount || 0) + 1;
        if (errorMessage) item.lastError = errorMessage;
        store.put(item);
      }
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // non-fatal
  }
}

export async function getPendingSyncCount(userId?: string): Promise<number> {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('syncQueue')) return 0;
    return new Promise((resolve) => {
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      const req = store.getAll();
      req.onsuccess = () => {
        const items: SyncQueueItem[] = req.result || [];
        const count = items.filter(
          (i) => (!userId || i.userId === userId) && i.status !== 'synced'
        ).length;
        resolve(count);
      };
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export async function clearSyncQueueForUser(userId: string): Promise<void> {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('syncQueue')) return;
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const req = store.getAll();
    req.onsuccess = () => {
      const items: SyncQueueItem[] = req.result || [];
      items.forEach((item) => {
        if (item.userId === userId) {
          store.delete(item.id);
        }
      });
      notifyPendingCountChanged();
    };
  } catch {
    // ignore
  }
}

type PendingCountListener = (count: number) => void;
const pendingCountListeners = new Set<PendingCountListener>();

export function subscribeToPendingSyncCount(callback: PendingCountListener): () => void {
  pendingCountListeners.add(callback);
  getPendingSyncCount(auth.currentUser?.uid).then((count) => callback(count));
  return () => {
    pendingCountListeners.delete(callback);
  };
}

export function notifyPendingCountChanged(): void {
  const uid = auth.currentUser?.uid;
  getPendingSyncCount(uid).then((count) => {
    pendingCountListeners.forEach((fn) => {
      try {
        fn(count);
      } catch (e) {
        console.warn('Sync count listener error:', e);
      }
    });
  });
}

