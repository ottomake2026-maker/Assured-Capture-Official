import { auth, db as firestoreDb } from './firebaseAuth';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
} from 'firebase/firestore';
import {
  getDB,
  ensureSafeImageSize,
  isQuotaExceededError,
  setFirestoreQuotaExhausted,
  getUserProfile,
  purgeLocalReportAndChildren,
} from '../db/storage';
import {
  computeEntityHash,
  logFirestoreWrite,
  processSyncQueue,
  removeUndefinedFields,
} from '../db/syncQueue';
import { Report, Issue, Photo } from '../types';

export interface FirestoreSyncProgress {
  total: number;
  completed: number;
  percentage: number;
  stage:
    | 'idle'
    | 'preparing'
    | 'syncing_reports'
    | 'syncing_issues'
    | 'syncing_photos'
    | 'downloading_remote'
    | 'complete'
    | 'warning'
    | 'error';
  statusMessage: string;
  itemDescription?: string;
  syncedReportsCount: number;
  syncedIssuesCount: number;
  syncedPhotosCount: number;
  remoteDownloadedCount: number;
  quotaExhausted?: boolean;
  errorMessage?: string;
}

const LAST_SYNC_KEY = 'assured_capture_last_firestore_sync';
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
    localStorage.setItem(SYNCED_HASH_KEY, JSON.stringify(hashes));
  } catch {
    // ignore
  }
}

export function getLastFirestoreSyncTime(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

export function setLastFirestoreSyncTime(isoString: string): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, isoString);
  } catch {
    // ignore
  }
}

export function formatSyncTime(isoString: string | null): string {
  if (!isoString) return 'Never synced';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Never synced';

    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) {
      return `Today at ${timeStr}`;
    }
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
  } catch {
    return 'Recently';
  }
}

/**
 * Manually synchronizes local IndexedDB data with Firestore cloud storage.
 * Performs intelligent delta synchronization: only writes modified or un-synced items.
 * Provides granular progress updates for UI progress bars.
 */
export async function syncLocalDataToFirestore(
  onProgress?: (progress: FirestoreSyncProgress) => void
): Promise<FirestoreSyncProgress> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const errProgress: FirestoreSyncProgress = {
      total: 1,
      completed: 0,
      percentage: 0,
      stage: 'error',
      statusMessage: 'Authentication required. Please sign in to sync with cloud storage.',
      syncedReportsCount: 0,
      syncedIssuesCount: 0,
      syncedPhotosCount: 0,
      remoteDownloadedCount: 0,
      errorMessage: 'Please sign in with an account to sync local data to Firestore.',
    };
    onProgress?.(errProgress);
    return errProgress;
  }

  const userId = currentUser.uid;

  // Offline check: safe exit without throwing or failing
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const offlineProgress: FirestoreSyncProgress = {
      total: 0,
      completed: 0,
      percentage: 0,
      stage: 'warning',
      statusMessage: 'Offline: Data is saved to this device and will sync when online.',
      syncedReportsCount: 0,
      syncedIssuesCount: 0,
      syncedPhotosCount: 0,
      remoteDownloadedCount: 0,
    };
    onProgress?.(offlineProgress);
    return offlineProgress;
  }

  // Reset quota flag tentatively to test connection
  setFirestoreQuotaExhausted(false);

  const initialProgress: FirestoreSyncProgress = {
    total: 10,
    completed: 0,
    percentage: 5,
    stage: 'preparing',
    statusMessage: 'Checking synchronization queue and local inspection records...',
    syncedReportsCount: 0,
    syncedIssuesCount: 0,
    syncedPhotosCount: 0,
    remoteDownloadedCount: 0,
  };
  onProgress?.(initialProgress);

  try {
    // Step 0: Process any existing queued items first
    await processSyncQueue();

    // 1. Gather all local data from IndexedDB
    const db = await getDB();
    const localData = await new Promise<{
      reports: Report[];
      issues: Issue[];
      photos: Photo[];
    }>((resolve, reject) => {
      const tx = db.transaction(['reports', 'issues', 'photos'], 'readonly');
      const rReq = tx.objectStore('reports').getAll();
      const iReq = tx.objectStore('issues').getAll();
      const pReq = tx.objectStore('photos').getAll();

      let reports: Report[] = [];
      let issues: Issue[] = [];
      let photos: Photo[] = [];

      rReq.onsuccess = () => {
        reports = rReq.result || [];
      };
      iReq.onsuccess = () => {
        issues = iReq.result || [];
      };
      pReq.onsuccess = () => {
        photos = pReq.result || [];
      };

      tx.oncomplete = () => resolve({ reports, issues, photos });
      tx.onerror = () => reject(tx.error);
    });

    let targetReports = localData.reports.filter((r) => !r.userId || r.userId === userId);
    let targetReportIds = new Set(targetReports.map((r) => r.id));

    let targetIssues = localData.issues.filter(
      (i) => (!i.userId || i.userId === userId) && (!i.reportId || targetReportIds.has(i.reportId))
    );
    let targetPhotos = localData.photos.filter(
      (p) => (!p.userId || p.userId === userId) && (!p.reportId || targetReportIds.has(p.reportId))
    );

    let syncedReportsCount = 0;
    let syncedIssuesCount = 0;
    let syncedPhotosCount = 0;
    let remoteDownloadedCount = 0;
    let quotaExceeded = false;

    // 1.5 Query Firestore remote reports to detect explicit cloud deletions & revisions BEFORE uploading
    const cloudDeletedReportIds = new Set<string>();
    const activeRemoteReportsMap = new Map<string, Report>();

    try {
      const q = query(collection(firestoreDb, 'reports'), where('userId', '==', userId));
      const querySnap = await getDocs(q);

      for (const rDoc of querySnap.docs) {
        const data = rDoc.data() as Report;
        const rId = data.id || rDoc.id;
        if (data.isDeleted || (data.status as string) === 'Deleted') {
          cloudDeletedReportIds.add(rId);
        } else {
          activeRemoteReportsMap.set(rId, data);
        }
      }

      // Reconcile cloud deletions:
      // If any reports were explicitly deleted in the cloud (tombstoned),
      // purge them from local IndexedDB immediately so stale local copies
      // never overwrite cloud deletions.
      if (cloudDeletedReportIds.size > 0) {
        for (const delId of cloudDeletedReportIds) {
          await purgeLocalReportAndChildren(delId);
        }
        targetReports = targetReports.filter((r) => !cloudDeletedReportIds.has(r.id));
        targetReportIds = new Set(targetReports.map((r) => r.id));
        targetIssues = targetIssues.filter(
          (i) => !cloudDeletedReportIds.has(i.reportId) && targetReportIds.has(i.reportId)
        );
        targetPhotos = targetPhotos.filter(
          (p) => !cloudDeletedReportIds.has(p.reportId) && targetReportIds.has(p.reportId)
        );
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaExceeded = true;
        setFirestoreQuotaExhausted(true);
      } else {
        console.warn('Initial cloud report query error:', err);
      }
    }

    let totalItems = targetReports.length + targetIssues.length + targetPhotos.length + 3;
    let completedItems = 1;

    const reportProgress = (
      stage: FirestoreSyncProgress['stage'],
      statusMessage: string,
      itemDescription?: string
    ) => {
      const percentage = Math.min(99, Math.max(5, Math.round((completedItems / totalItems) * 100)));
      onProgress?.({
        total: totalItems,
        completed: completedItems,
        percentage,
        stage,
        statusMessage,
        itemDescription,
        syncedReportsCount,
        syncedIssuesCount,
        syncedPhotosCount,
        remoteDownloadedCount,
        quotaExhausted: quotaExceeded,
      });
    };

    const syncedHashes = getSyncedHashes();

    // 2. Upload local reports (delta only: write if hash changed or unrecorded)
    for (let idx = 0; idx < targetReports.length; idx++) {
      const rep = targetReports[idx];
      const safeImage = rep.reportImage ? await ensureSafeImageSize(rep.reportImage) : undefined;
      const updatedRep: Record<string, any> = {
        ...rep,
        reportType: rep.reportType || 'Photo Report',
        userId,
        updatedAt: rep.updatedAt || new Date().toISOString(),
      };
      if (safeImage) {
        updatedRep.reportImage = safeImage;
      } else {
        delete updatedRep.reportImage;
      }

      const entityKey = `report_${rep.id}`;
      const currentHash = computeEntityHash(updatedRep, 'report');
      const lastHash = syncedHashes[entityKey];

      reportProgress(
        'syncing_reports',
        `Checking report ${idx + 1} of ${targetReports.length}: ${rep.jobReference || rep.reportName || rep.id}`,
        rep.jobReference || rep.reportName
      );

      if (lastHash !== currentHash) {
        try {
          const docRef = doc(firestoreDb, 'reports', updatedRep.id);
          await setDoc(docRef, removeUndefinedFields(updatedRep), { merge: true });
          setSyncedHash(entityKey, currentHash);
          syncedReportsCount++;

          logFirestoreWrite({
            operation: 'setDoc',
            path: `reports/${updatedRep.id}`,
            source: 'manual_sync',
            uid: userId,
            dataChanged: true,
            entityType: 'report',
            details: rep.jobReference,
          });
        } catch (err) {
          if (isQuotaExceededError(err)) {
            quotaExceeded = true;
            setFirestoreQuotaExhausted(true);
            break;
          } else {
            console.warn('Sync report error:', err);
          }
        }
      } else {
        // Unchanged
        syncedReportsCount++;
      }
      completedItems++;
    }

    // 3. Upload local issues (delta only)
    if (!quotaExceeded) {
      for (let idx = 0; idx < targetIssues.length; idx++) {
        const iss = targetIssues[idx];
        if (!iss.reportId) {
          completedItems++;
          continue;
        }

        const updatedIss: Issue = {
          ...iss,
          userId,
          updatedAt: iss.updatedAt || new Date().toISOString(),
        };

        const entityKey = `issue_${iss.id}`;
        const currentHash = computeEntityHash(updatedIss, 'issue');
        const lastHash = syncedHashes[entityKey];

        reportProgress(
          'syncing_issues',
          `Checking issue ${idx + 1} of ${targetIssues.length}: #${iss.issueNumber} - ${iss.issueName || 'Defect'}`,
          iss.issueName || iss.notes || `Issue #${iss.issueNumber}`
        );

        if (lastHash !== currentHash) {
          try {
            const docRef = doc(firestoreDb, 'reports', iss.reportId, 'issues', iss.id);
            await setDoc(docRef, removeUndefinedFields(updatedIss), { merge: true });
            setSyncedHash(entityKey, currentHash);
            syncedIssuesCount++;

            logFirestoreWrite({
              operation: 'setDoc',
              path: `reports/${iss.reportId}/issues/${iss.id}`,
              source: 'manual_sync',
              uid: userId,
              dataChanged: true,
              entityType: 'issue',
            });
          } catch (err) {
            if (isQuotaExceededError(err)) {
              quotaExceeded = true;
              setFirestoreQuotaExhausted(true);
              break;
            } else {
              console.warn('Sync issue error:', err);
            }
          }
        } else {
          syncedIssuesCount++;
        }
        completedItems++;
      }
    }

    // 4. Upload local photos (metadata + references per Section 8)
    if (!quotaExceeded) {
      for (let idx = 0; idx < targetPhotos.length; idx++) {
        const pho = targetPhotos[idx];
        if (!pho.reportId) {
          completedItems++;
          continue;
        }

        const updatedPho: Photo = {
          ...pho,
          userId,
          updatedAt: pho.updatedAt || new Date().toISOString(),
        };

        const entityKey = `photo_${pho.id}`;
        const currentHash = computeEntityHash(updatedPho, 'photo');
        const lastHash = syncedHashes[entityKey];

        const photoLabel = pho.sequenceNumber
          ? `Evidence #${pho.sequenceNumber}`
          : `Issue #${pho.issueNumber} Photo`;

        reportProgress(
          'syncing_photos',
          `Checking photo ${idx + 1} of ${targetPhotos.length}: ${photoLabel}`,
          pho.description || photoLabel
        );

        if (lastHash !== currentHash) {
          try {
            const firestorePhotoDoc: any = {
              id: pho.id,
              reportId: pho.reportId,
              issueId: pho.issueId,
              userId,
              issueNumber: pho.issueNumber,
              jobReference: pho.jobReference || '',
              sequenceNumber: pho.sequenceNumber || 1,
              description: pho.description || '',
              isReferenceImage: !!pho.isReferenceImage,
              internalNotes: pho.internalNotes || '',
              includeInReport: pho.includeInReport !== false,
              storageUri: pho.storageUri || `gs://assured-capture-storage/reports/${pho.reportId}/photos/${pho.id}.jpg`,
              createdAt: pho.createdAt || new Date().toISOString(),
              updatedAt: pho.updatedAt || new Date().toISOString(),
            };

            // Persist full compressed imageFile and markup to Firestore (within 1MB document limit)
            if (pho.imageFile) {
              firestorePhotoDoc.imageFile = pho.imageFile;
            }
            if (pho.textBoxAnnotations) {
              firestorePhotoDoc.textBoxAnnotations = pho.textBoxAnnotations;
            }
            if (pho.originalImageFile) {
              firestorePhotoDoc.originalImageFile = pho.originalImageFile;
            }
            if (pho.capturedAt !== undefined) {
              firestorePhotoDoc.capturedAt = pho.capturedAt;
            }

            const docRef = doc(firestoreDb, 'reports', pho.reportId, 'photos', pho.id);
            await setDoc(docRef, removeUndefinedFields(firestorePhotoDoc), { merge: true });
            setSyncedHash(entityKey, currentHash);
            syncedPhotosCount++;

            logFirestoreWrite({
              operation: 'setDoc',
              path: `reports/${pho.reportId}/photos/${pho.id}`,
              source: 'manual_sync',
              uid: userId,
              dataChanged: true,
              entityType: 'photo',
            });
          } catch (err) {
            if (isQuotaExceededError(err)) {
              quotaExceeded = true;
              setFirestoreQuotaExhausted(true);
              break;
            } else {
              console.warn('Sync photo error:', err);
            }
          }
        } else {
          syncedPhotosCount++;
        }
        completedItems++;
      }
    }

    // 5. Download remote reports, issues, and photos from Firestore (if local is missing them)
    if (!quotaExceeded) {
      reportProgress('downloading_remote', 'Checking for cloud revisions...');
      try {
        const localReportMap = new Map<string, Report>();
        targetReports.forEach((r) => localReportMap.set(r.id, r));

        const localIssueMap = new Map<string, Issue>();
        targetIssues.forEach((i) => localIssueMap.set(i.id, i));

        const localPhotoMap = new Map<string, Photo>();
        targetPhotos.forEach((p) => localPhotoMap.set(p.id, p));

        const reportsToPut: Report[] = [];
        const issuesToPut: Issue[] = [];
        const photosToPut: Photo[] = [];

        // Iterate through active remote reports (excluding any cloud-deleted reports)
        for (const [remoteId, remoteData] of activeRemoteReportsMap.entries()) {
          const localRep = localReportMap.get(remoteId);

          if (!localRep || (remoteData.updatedAt && (!localRep.updatedAt || new Date(remoteData.updatedAt) > new Date(localRep.updatedAt)))) {
            reportsToPut.push(remoteData);
          }

          try {
            const issuesSnap = await getDocs(
              collection(firestoreDb, 'reports', remoteId, 'issues')
            );
            for (const iDoc of issuesSnap.docs) {
              const remoteIss = iDoc.data() as Issue;
              const localIss = localIssueMap.get(remoteIss.id);
              if (!localIss || (remoteIss.updatedAt && (!localIss.updatedAt || new Date(remoteIss.updatedAt) > new Date(localIss.updatedAt)))) {
                issuesToPut.push(remoteIss);
              }
            }

            const photosSnap = await getDocs(
              collection(firestoreDb, 'reports', remoteId, 'photos')
            );
            for (const pDoc of photosSnap.docs) {
              const remotePho = pDoc.data() as Photo;
              const localPho = localPhotoMap.get(remotePho.id);
              if (
                !localPho ||
                (!localPho.imageFile && remotePho.imageFile) ||
                (remotePho.updatedAt && (!localPho.updatedAt || new Date(remotePho.updatedAt) > new Date(localPho.updatedAt)))
              ) {
                photosToPut.push(remotePho);
              }
            }
          } catch (subErr) {
            console.warn('Subcollection fetch error:', subErr);
          }
        }

        // Commit all downloaded reports, issues, and photos in a single synchronous IndexedDB transaction
        // (No await inside transaction to avoid TransactionInactiveError)
        if (reportsToPut.length > 0 || issuesToPut.length > 0 || photosToPut.length > 0) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['reports', 'issues', 'photos'], 'readwrite');
            const reportStore = tx.objectStore('reports');
            const issueStore = tx.objectStore('issues');
            const photoStore = tx.objectStore('photos');

            for (const rep of reportsToPut) {
              reportStore.put(rep);
              setSyncedHash(`report_${rep.id}`, computeEntityHash(rep, 'report'));
            }
            for (const iss of issuesToPut) {
              issueStore.put(iss);
              setSyncedHash(`issue_${iss.id}`, computeEntityHash(iss, 'issue'));
            }
            for (const pho of photosToPut) {
              photoStore.put(pho);
              setSyncedHash(`photo_${pho.id}`, computeEntityHash(pho, 'photo'));
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });

          remoteDownloadedCount += (reportsToPut.length + issuesToPut.length + photosToPut.length);
        }
      } catch (err) {
        if (isQuotaExceededError(err)) {
          quotaExceeded = true;
          setFirestoreQuotaExhausted(true);
        }
      }
    }
    completedItems++;

    // 6. User Profile sync
    try {
      const profile = getUserProfile();
      if (profile && !quotaExceeded) {
        const userDoc = doc(firestoreDb, 'users', userId);
        const profileName = profile.profileName || profile.fullName || profile.name || '';
        const displayName = profile.displayName || profile.name || profileName || '';
        await setDoc(
          userDoc,
          {
            userId,
            profileName,
            displayName,
            name: displayName || profileName || profile.name || '',
            fullName: profileName || displayName || profile.fullName || '',
            email: profile.email || currentUser.email || '',
            avatarUrl: profile.avatarUrl || profile.photoURL || '',
            photoURL: profile.photoURL || profile.avatarUrl || null,
            avatarStorageUri: profile.avatarStorageUri || (profile.avatarUrl ? `gs://assured-capture-storage/users/${userId}/avatar.jpg` : ''),
            role: profile.role || '',
            accountType: 'authenticated',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaExceeded = true;
        setFirestoreQuotaExhausted(true);
      }
    }
    completedItems++;

    // Record last sync timestamp
    const nowIso = new Date().toISOString();
    setLastFirestoreSyncTime(nowIso);

    if (quotaExceeded) {
      const warnProgress: FirestoreSyncProgress = {
        total: totalItems,
        completed: completedItems,
        percentage: 100,
        stage: 'warning',
        statusMessage: `Daily cloud write quota reached. Successfully synchronized ${syncedReportsCount} report(s), ${syncedIssuesCount} issue(s), and ${syncedPhotosCount} photo(s). Remaining items remain safely stored offline.`,
        syncedReportsCount,
        syncedIssuesCount,
        syncedPhotosCount,
        remoteDownloadedCount,
        quotaExhausted: true,
      };
      onProgress?.(warnProgress);
      return warnProgress;
    }

    const successProgress: FirestoreSyncProgress = {
      total: totalItems,
      completed: totalItems,
      percentage: 100,
      stage: 'complete',
      statusMessage: `Sync complete! Synchronized ${syncedReportsCount} report(s), ${syncedIssuesCount} issue(s), and ${syncedPhotosCount} photo(s).`,
      syncedReportsCount,
      syncedIssuesCount,
      syncedPhotosCount,
      remoteDownloadedCount,
      quotaExhausted: false,
    };
    onProgress?.(successProgress);
    return successProgress;
  } catch (err: any) {
    console.error('Manual Firestore sync error:', err);
    const errProgress: FirestoreSyncProgress = {
      total: 10,
      completed: 0,
      percentage: 0,
      stage: 'error',
      statusMessage: err?.message || 'Synchronization encountered an unexpected error.',
      syncedReportsCount: 0,
      syncedIssuesCount: 0,
      syncedPhotosCount: 0,
      remoteDownloadedCount: 0,
      errorMessage: err?.message || 'Synchronization failed.',
    };
    onProgress?.(errProgress);
    return errProgress;
  }
}
