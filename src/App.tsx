import React, { useState, useEffect, useCallback } from 'react';
import {
  Report,
  Issue,
  Photo,
  ActiveScreen,
  UserProfile,
} from './types';
import {
  getAllReports,
  getReportById,
  saveReport,
  deleteReport,
  getIssuesForReport,
  getIssueById,
  saveIssue,
  deleteIssue,
  reorderIssuesForReport,
  getNextIssueNumber,
  getPhotosForIssue,
  getPhotoById,
  savePhoto,
  deletePhoto,
  reorderPhotosForIssue,
  createNewReportDraft,
  getUserProfile,
  saveUserProfileToAccount,
  createEmptyGuestProfile,
  clearStoredUserProfile,
  fetchUserProfileFromFirestore,
  migrateExistingLocalData,
  clearLocalCacheOnSignOut,
  subscribeToQuotaStatus,
} from './db/storage';
import { subscribeToPendingSyncCount, scheduleSyncQueueProcessing } from './db/syncQueue';
import { useOnlineStatus } from './utils/useOnlineStatus';
import { OfflineIndicator } from './components/OfflineIndicator';
import { initAuth, logout, auth } from './utils/firebaseAuth';
import { syncLocalDataToFirestore } from './utils/firestoreSync';
import { checkMyAuthStatus } from './utils/adminApi';
import { User } from 'firebase/auth';
import { AuthScreen } from './components/AuthScreen';
import { ReportsHomeScreen } from './components/ReportsHomeScreen';
import { ReportDetailScreen } from './components/ReportDetailScreen';
import { IssuesListScreen } from './components/IssuesListScreen';
import { IssueDetailScreen } from './components/IssueDetailScreen';
import { PhotoDetailScreen } from './components/PhotoDetailScreen';
import { UserProfileScreen } from './components/UserProfileScreen';
import { AdminUsersScreen } from './components/AdminUsersScreen';
import { AssuredLogo } from './components/AssuredLogo';
import { AlertCircle } from 'lucide-react';

export default function App() {
  // Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(true);
  const [isGuestMode, setIsGuestMode] = useState(false);

  // Network & Offline resilience state
  const { isOnline, wasOffline, clearWasOffline } = useOnlineStatus();
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);

  // Navigation state
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('reports_home');
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);

  // User profile state
  const [userProfile, setUserProfile] = useState<UserProfile>(getUserProfile());

  // Data state
  const [reports, setReports] = useState<Report[]>([]);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [activeReportIssues, setActiveReportIssues] = useState<Issue[]>([]);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [activeIssuePhotos, setActiveIssuePhotos] = useState<Photo[]>([]);
  const [activePhoto, setActivePhoto] = useState<Photo | null>(null);
  const [issueDrafts, setIssueDrafts] = useState<Record<string, { issueName: string; issueDescription: string; notes: string }>>({});

  // App loading and error states
  const [isLoading, setIsLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ text: string; type: 'loading' | 'success' | 'error' } | null>(null);
  const [isCreatingNewReport, setIsCreatingNewReport] = useState(false);
  const [isNewReportWorkflow, setIsNewReportWorkflow] = useState(false);
  const [isQuotaExhausted, setIsQuotaExhausted] = useState(false);
  const [isQuotaNoticeDismissed, setIsQuotaNoticeDismissed] = useState(false);

  // Subscribe to quota status changes
  useEffect(() => {
    const unsubscribe = subscribeToQuotaStatus((exhausted) => {
      setIsQuotaExhausted(exhausted);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to pending sync queue count for real-time offline/sync indicators
  useEffect(() => {
    const unsubscribe = subscribeToPendingSyncCount((count) => {
      setPendingSyncCount(count);
    });
    return () => unsubscribe();
  }, []);

  // Load all reports (loads from primary local IndexedDB working copy)
  const refreshReports = useCallback(async (explicitUserId?: string) => {
    try {
      const data = await getAllReports(explicitUserId);
      setReports(data);
      // Clean up active report if it was deleted on another device
      setActiveReportId((currentId) => {
        if (currentId && !data.some((r) => r.id === currentId)) {
          setActiveReport(null);
          setActiveReportIssues([]);
          setActiveIssue(null);
          setActiveIssueId(null);
          setActiveIssuePhotos([]);
          setActivePhoto(null);
          setActivePhotoId(null);
          setActiveScreen((curr) => (curr !== 'user_profile' ? 'reports_home' : curr));
          return null;
        }
        return currentId;
      });
    } catch (err: any) {
      console.error('Failed to load reports:', err);
      setGlobalError('Failed to load reports from storage.');
    }
  }, []);

  // Load issues and their photo counts for active report
  const refreshActiveReportIssues = useCallback(async (reportId: string) => {
    try {
      const issues = await getIssuesForReport(reportId);
      setActiveReportIssues(issues);

      // Fetch photo counts for each issue
      const counts: Record<string, number> = {};
      for (const issue of issues) {
        const photos = await getPhotosForIssue(issue.id);
        counts[issue.id] = photos.length;
      }
      setPhotoCounts(counts);
    } catch (err: any) {
      console.error('Failed to load issues:', err);
    }
  }, []);

  // Load photos for active issue
  const refreshActiveIssuePhotos = useCallback(async (issueId: string) => {
    try {
      const photos = await getPhotosForIssue(issueId);
      setActiveIssuePhotos(photos);
    } catch (err: any) {
      console.error('Failed to load photos for issue:', err);
    }
  }, []);

  // Initialize Auth state listener
  useEffect(() => {
    const unsubscribe = initAuth(async (user) => {
      setCurrentUser(user);
      setAuthLoading(false);

      if (user) {
        setIsGuestMode(false);
        setIsLoading(true);
        setSyncStatus({ text: 'Loading your reports…', type: 'loading' });

        // 1. Primary data source first: Load existing reports from local storage immediately
        try {
          await refreshReports(user.uid);
        } catch (e) {
          console.warn('Initial local cache read error:', e);
        }

        // 2. Fetch user profile from canonical Firestore database
        try {
          let profile = await fetchUserProfileFromFirestore(user.uid);
          if (!profile) {
            const defaultName = user.displayName || '';
            profile = {
              userId: user.uid,
              email: user.email || '',
              profileName: defaultName,
              displayName: defaultName,
              name: defaultName || 'User Profile',
              fullName: defaultName || 'User Profile',
              avatarUrl: user.photoURL || '',
              photoURL: user.photoURL || null,
              role: '',
              accountType: 'authenticated',
            };
            try {
              await saveUserProfileToAccount(profile);
            } catch (err) {
              console.warn('Initial profile cloud sync notice:', err);
            }
          }

          // Fetch authoritative server session role
          try {
            const authStatus = await checkMyAuthStatus();
            if (authStatus && authStatus.role) {
              profile.role = authStatus.role;
            }
          } catch (authErr) {
            if ((user.email || '').toLowerCase() === 'ottomake2026@gmail.com') {
              profile.role = 'Administrator';
            } else if (!profile.role) {
              profile.role = 'User';
            }
          }

          setUserProfile(profile);
        } catch (profileErr) {
          console.warn('Profile fetch error:', profileErr);
        }

        // 3. Migrate any unassigned local records to this authenticated user
        try {
          await migrateExistingLocalData(user.uid);
        } catch (migErr) {
          console.warn('Local data migration notice:', migErr);
        }

        // 4. Synchronize with Firestore application database
        try {
          await syncLocalDataToFirestore();
        } catch (syncErr) {
          console.warn('Firestore database sync notice:', syncErr);
        }

        // 5. Reload reports from application database/storage
        try {
          await refreshReports(user.uid);
          setSyncStatus({ text: 'Reports loaded.', type: 'success' });
          setTimeout(() => setSyncStatus(null), 3000);
        } catch (err) {
          console.error('Data reload error:', err);
        } finally {
          setIsLoading(false);
        }
      } else {
        // Logged out: reset active workspace state unless currently in guest mode
        setIsGuestMode(false);
        clearStoredUserProfile();
        setUserProfile(createEmptyGuestProfile());
        setReports([]);
        setActiveReport(null);
        setActiveReportId(null);
        setActiveReportIssues([]);
        setActiveIssue(null);
        setActiveIssueId(null);
        setActiveIssuePhotos([]);
        setActivePhoto(null);
        setActivePhotoId(null);
        setActiveScreen('reports_home');
        setIsLoading(false);
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [refreshReports]);

  // Auto-sync when reconnecting back online
  useEffect(() => {
    if (wasOffline && isOnline && currentUser?.uid) {
      scheduleSyncQueueProcessing(100);
      syncLocalDataToFirestore()
        .then(() => refreshReports(currentUser.uid))
        .catch((err) => console.warn('Reconnect sync notice:', err));
    }
  }, [wasOffline, isOnline, currentUser, refreshReports]);

  // Handle Trigger Manual Cloud Sync
  const handleTriggerManualSync = async () => {
    if (!isOnline) {
      setSyncStatus({ text: 'Offline: Changes saved safely on this device.', type: 'error' });
      setTimeout(() => setSyncStatus(null), 3500);
      return;
    }
    if (!currentUser) return;
    if (isManualSyncing) return;

    setIsManualSyncing(true);
    setSyncStatus({ text: 'Synchronizing with cloud…', type: 'loading' });
    try {
      scheduleSyncQueueProcessing(50);
      await syncLocalDataToFirestore();
      await refreshReports(currentUser.uid);
      setSyncStatus({ text: 'All changes synchronized.', type: 'success' });
      setTimeout(() => setSyncStatus(null), 3000);
    } catch (err: any) {
      console.warn('Manual sync notice:', err);
      setSyncStatus({ text: 'Sync notice: Changes saved to local storage.', type: 'error' });
      setTimeout(() => setSyncStatus(null), 3500);
    } finally {
      setIsManualSyncing(false);
    }
  };

  // Handle User Sign Out or Exiting Guest Session
  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      if (currentUser) {
        await clearLocalCacheOnSignOut();
        await logout();
      }
      clearStoredUserProfile();
      setIsGuestMode(false);
      setCurrentUser(null);
      setUserProfile(createEmptyGuestProfile());
      setReports([]);
      setActiveReport(null);
      setActiveReportId(null);
      setActiveReportIssues([]);
      setActiveIssue(null);
      setActiveIssueId(null);
      setActiveIssuePhotos([]);
      setActivePhoto(null);
      setActivePhotoId(null);
      setActiveScreen('reports_home');
    } catch (err: any) {
      console.error('Sign out error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle continuing without an account (Guest Mode)
  const handleContinueAsGuest = async () => {
    setIsGuestMode(true);
    setIsLoading(true);
    clearStoredUserProfile();
    setUserProfile(createEmptyGuestProfile());
    try {
      await refreshReports();
    } finally {
      setIsLoading(false);
    }
  };

  // Handle returning to Sign In screen from Guest Mode without clearing local guest data
  const handleRequestSignIn = () => {
    setIsGuestMode(false);
    clearStoredUserProfile();
    setUserProfile(createEmptyGuestProfile());
  };

  // Handle Create New Report (holds in-memory draft; will not persist empty report until user enters Job Reference)
  const handleCreateNewReport = () => {
    try {
      const newReport = createNewReportDraft();
      if (currentUser?.uid) {
        newReport.userId = currentUser.uid;
      }
      setActiveReport(newReport);
      setActiveReportId(newReport.id);
      setActiveReportIssues([]);
      setPhotoCounts({});
      setIsCreatingNewReport(true);
      setIsNewReportWorkflow(true);
      setActiveScreen('report_detail');
    } catch (err: any) {
      console.error('Failed to create new report:', err);
      setGlobalError('Could not create new report.');
    }
  };

  // Handle Open Report
  const handleOpenReport = async (reportId: string) => {
    setIsLoading(true);
    try {
      const rep = await getReportById(reportId);
      if (rep) {
        setActiveReport(rep);
        setActiveReportId(rep.id);
        await refreshActiveReportIssues(rep.id);
        setIsCreatingNewReport(false);
        setIsNewReportWorkflow(false);
        setActiveScreen('report_detail');
      }
    } catch (err: any) {
      console.error('Failed to open report:', err);
      setGlobalError('Unable to open selected report.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Save Report
  const handleSaveReport = async (updated: Report): Promise<boolean> => {
    try {
      if (currentUser?.uid && !updated.userId) {
        updated.userId = currentUser.uid;
      }
      await saveReport(updated);
      setActiveReport(updated);
      setIsCreatingNewReport(false);
      await refreshReports();
      return true;
    } catch (err) {
      console.error('Save report error:', err);
      return false;
    }
  };

  // Handle Delete Report
  const handleDeleteReport = async (reportId: string): Promise<boolean> => {
    try {
      await deleteReport(reportId);
      setActiveReport(null);
      setActiveReportId(null);
      setActiveReportIssues([]);
      setActiveScreen('reports_home');
      await refreshReports();
      return true;
    } catch (err) {
      console.error('Delete report error:', err);
      return false;
    }
  };

  // Handle Add Issue (in-memory draft until meaningful content or evidence is added)
  const handleAddIssue = async () => {
    if (!activeReport) return;
    try {
      const nextNum = await getNextIssueNumber(activeReport.id);
      const newIssue: Issue = {
        id: 'iss_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
        reportId: activeReport.id,
        userId: currentUser?.uid || activeReport.userId,
        issueNumber: nextNum,
        issueName: '',
        issueDescription: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setActiveIssue(newIssue);
      setActiveIssueId(newIssue.id);
      setActiveIssuePhotos([]);
      setActiveScreen('issue_detail');
    } catch (err: any) {
      console.error('Failed to add issue:', err);
      setGlobalError('Could not generate new numbered issue.');
    }
  };

  // Handle Open Issue
  const handleOpenIssue = async (issueId: string) => {
    setIsLoading(true);
    try {
      const iss = await getIssueById(issueId);
      if (iss) {
        setActiveIssue(iss);
        setActiveIssueId(iss.id);
        await refreshActiveIssuePhotos(iss.id);
        setActiveScreen('issue_detail');
      }
    } catch (err: any) {
      console.error('Failed to open issue:', err);
      setGlobalError('Unable to open selected issue.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Save Issue
  const handleSaveIssue = async (updated: Issue): Promise<boolean> => {
    try {
      if (currentUser?.uid && !updated.userId) {
        updated.userId = currentUser.uid;
      }
      await saveIssue(updated);
      setActiveIssue(updated);
      setIssueDrafts(prev => {
        const next = { ...prev };
        delete next[updated.id];
        return next;
      });
      if (activeReport) {
        await refreshActiveReportIssues(activeReport.id);
      }
      return true;
    } catch (err) {
      console.error('Save issue error:', err);
      return false;
    }
  };

  // Handle Save Issues (bulk/state commit on dedicated Issues screen)
  const handleSaveIssues = async (): Promise<boolean> => {
    if (!activeReport) return true;
    try {
      const currentIssues = await getIssuesForReport(activeReport.id);

      for (const issue of currentIssues) {
        const draft = issueDrafts[issue.id];
        if (draft) {
          const updated: Issue = {
            ...issue,
            userId: currentUser?.uid || issue.userId || activeReport.userId,
            issueName: draft.issueName,
            issueDescription: draft.issueDescription,
            notes: draft.notes,
            updatedAt: new Date().toISOString(),
          };
          await saveIssue(updated);
        } else if (currentUser?.uid && !issue.userId) {
          issue.userId = currentUser.uid;
          await saveIssue(issue);
        }
      }

      setIssueDrafts({});
      await refreshActiveReportIssues(activeReport.id);

      const freshReport = await getReportById(activeReport.id);
      if (freshReport) {
        setActiveReport(freshReport);
      }
      return true;
    } catch (err) {
      console.error('Save issues error:', err);
      return false;
    }
  };

  // Handle Delete Issue
  const handleDeleteIssue = async (issueId: string): Promise<boolean> => {
    try {
      await deleteIssue(issueId);
      setActiveIssue(null);
      setActiveIssueId(null);
      setActiveIssuePhotos([]);
      setIssueDrafts(prev => {
        const next = { ...prev };
        delete next[issueId];
        return next;
      });
      setActiveScreen('issues_list');
      if (activeReport) {
        await refreshActiveReportIssues(activeReport.id);
      }
      return true;
    } catch (err) {
      console.error('Delete issue error:', err);
      return false;
    }
  };

  // Handle Reorder Issues
  const handleReorderIssues = async (reorderedIssues: Issue[]) => {
    if (!activeReport) return;
    try {
      setActiveReportIssues(reorderedIssues);
      const orderedIds = reorderedIssues.map(i => i.id);
      const updated = await reorderIssuesForReport(activeReport.id, orderedIds);
      setActiveReportIssues(updated);
    } catch (err) {
      console.error('Failed to reorder issues:', err);
      if (activeReport) {
        await refreshActiveReportIssues(activeReport.id);
      }
    }
  };

  const handleUpdateIssueDraft = (issueId: string, draft: { issueName: string; issueDescription: string; notes: string }) => {
    setIssueDrafts(prev => ({
      ...prev,
      [issueId]: draft,
    }));
  };

  // Handle Open Photo
  const handleOpenPhoto = async (photoId: string) => {
    setIsLoading(true);
    try {
      const pho = await getPhotoById(photoId);
      if (pho) {
        setActivePhoto(pho);
        setActivePhotoId(pho.id);
        setActiveScreen('photo_detail');
      }
    } catch (err: any) {
      console.error('Failed to open photo:', err);
      setGlobalError('Unable to open photo details.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Save Photo
  const handleSavePhoto = async (updated: Photo): Promise<boolean> => {
    try {
      if (currentUser?.uid && !updated.userId) {
        updated.userId = currentUser.uid;
      }
      await savePhoto(updated);
      setActivePhoto(updated);
      if (activeIssue) {
        await refreshActiveIssuePhotos(activeIssue.id);
      }
      if (activeReport) {
        await refreshActiveReportIssues(activeReport.id);
      }
      return true;
    } catch (err) {
      console.error('Save photo error:', err);
      return false;
    }
  };

  // Handle Delete Photo
  const handleDeletePhoto = async (photoId: string): Promise<boolean> => {
    try {
      await deletePhoto(photoId);
      setActivePhoto(null);
      setActivePhotoId(null);
      setActiveScreen('issue_detail');
      if (activeIssue) {
        await refreshActiveIssuePhotos(activeIssue.id);
      }
      if (activeReport) {
        await refreshActiveReportIssues(activeReport.id);
      }
      return true;
    } catch (err) {
      console.error('Delete photo error:', err);
      return false;
    }
  };

  // Handle Reorder Photos within active issue
  const handleReorderPhotos = async (reorderedPhotos: Photo[]) => {
    if (!activeIssue) return;
    try {
      setActiveIssuePhotos(reorderedPhotos);
      const orderedIds = reorderedPhotos.map(p => p.id);
      const updated = await reorderPhotosForIssue(activeIssue.id, orderedIds);
      setActiveIssuePhotos(updated);
    } catch (err) {
      console.error('Failed to reorder photos:', err);
      if (activeIssue) {
        await refreshActiveIssuePhotos(activeIssue.id);
      }
    }
  };

  // Handle saving profile
  const handleSaveUserProfile = async (updated: UserProfile): Promise<UserProfile> => {
    const saved = await saveUserProfileToAccount(updated);
    setUserProfile(saved);
    return saved;
  };

  // 1. Loading splash screen while checking session
  if (authLoading) {
    return (
      <div
        id="auth_session_loading"
        className="min-h-screen bg-[#F4F6F8] flex flex-col items-center justify-center px-4 py-8 select-none"
      >
        <div className="w-full max-w-sm mx-auto text-center space-y-5">
          {/* ASSURED CAPTURE brand lockup */}
          <div className="flex items-baseline justify-center gap-2 select-none">
            <AssuredLogo className="h-7 sm:h-8" />
            <span className="font-sans font-extrabold tracking-[0.18em] text-xs sm:text-sm text-[#628EF7] uppercase select-none">
              CAPTURE
            </span>
          </div>

          {/* Clean branded loading status */}
          <div className="flex items-center justify-center gap-2.5 text-[#0E1E2B] pt-1">
            <span className="w-4 h-4 border-2 border-[#0E1E2B]/20 border-t-[#628EF7] rounded-full animate-spin shrink-0" />
            <span className="text-sm font-medium text-[#0E1E2B] tracking-wide">
              Securing your workspace…
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated state: display dedicated AuthScreen
  if (!currentUser) {
    return (
      <AuthScreen
        onAuthenticated={() => refreshReports()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F6F8] text-[#0E1E2B] font-sans antialiased selection:bg-[#B2E5F6] selection:text-[#0E1E2B] pb-16">
      {/* Global Error Notice */}
      {globalError && (
        <div className="max-w-3xl lg:max-w-4xl mx-auto px-4 mt-4">
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-sm font-medium flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{globalError}</span>
            </div>
            <button
              onClick={() => setGlobalError(null)}
              className="text-xs font-semibold text-rose-700 hover:text-rose-900 underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Cloud Quota / Offline Safe Mode Notice */}
      {isQuotaExhausted && !isQuotaNoticeDismissed && (
        <div id="firestore_quota_notice" className="max-w-3xl lg:max-w-4xl mx-auto px-4 mt-3">
          <div className="p-3 bg-[#0E1E2B] border border-[#8DE9F6]/30 rounded-xl text-slate-200 text-xs font-medium flex items-center justify-between gap-3 shadow-md">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-[#8DE9F6] shrink-0 animate-pulse" />
              <span className="leading-snug text-slate-300">
                <strong className="text-white font-semibold">LOCAL STORAGE MODE:</strong> Changes are saved on this device and will sync when cloud storage is available.
              </span>
            </div>
            <button
              onClick={() => setIsQuotaNoticeDismissed(true)}
              className="text-[11px] font-semibold text-[#8DE9F6] hover:text-white transition-colors underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Primary Screen Render */}
      <main>
        {activeScreen === 'reports_home' && (
          <ReportsHomeScreen
            reports={reports}
            userProfile={userProfile}
            onOpenReport={handleOpenReport}
            onCreateNewReport={handleCreateNewReport}
            onOpenProfile={() => setActiveScreen('user_profile')}
            isLoading={isLoading}
            isGuest={!currentUser}
            onSignInRequest={handleRequestSignIn}
            syncStatus={syncStatus}
            isOnline={isOnline}
            pendingSyncCount={pendingSyncCount}
            isSyncing={isManualSyncing}
          />
        )}

        {activeScreen === 'user_profile' && (
          <UserProfileScreen
            profile={userProfile}
            reports={reports}
            onBack={() => setActiveScreen('reports_home')}
            onSaveProfile={handleSaveUserProfile}
            onSignOut={handleSignOut}
            onRequestSignIn={handleRequestSignIn}
            onOpenAdminUsers={() => setActiveScreen('admin_users')}
            isGuest={!currentUser}
            onSyncComplete={refreshReports}
          />
        )}

        {activeScreen === 'admin_users' && (
          currentUser && ((currentUser.email || '').toLowerCase() === 'ottomake2026@gmail.com' || userProfile.role === 'Administrator') ? (
            <AdminUsersScreen
              currentUserProfile={userProfile}
              onBack={() => setActiveScreen('user_profile')}
            />
          ) : (
            <UserProfileScreen
              profile={userProfile}
              reports={reports}
              onBack={() => setActiveScreen('reports_home')}
              onSaveProfile={handleSaveUserProfile}
              onSignOut={handleSignOut}
              onRequestSignIn={handleRequestSignIn}
              onOpenAdminUsers={() => setActiveScreen('admin_users')}
              isGuest={!currentUser}
              onSyncComplete={refreshReports}
            />
          )
        )}

        {activeScreen === 'report_detail' && activeReport && (
          <ReportDetailScreen
            report={activeReport}
            issues={activeReportIssues}
            photoCounts={photoCounts}
            onBack={() => {
              setIsCreatingNewReport(false);
              setIsNewReportWorkflow(false);
              setActiveScreen('reports_home');
            }}
            onSaveReport={handleSaveReport}
            onOpenIssuesList={() => setActiveScreen('issues_list')}
            onAddIssue={handleAddIssue}
            onOpenIssue={handleOpenIssue}
            onDeleteReport={handleDeleteReport}
            isNewReport={isCreatingNewReport}
          />
        )}

        {activeScreen === 'issues_list' && activeReport && (
          <IssuesListScreen
            report={activeReport}
            issues={activeReportIssues}
            photoCounts={photoCounts}
            isNewReportWorkflow={isNewReportWorkflow}
            onBackToReport={() => {
              setIsNewReportWorkflow(false);
              setActiveScreen('report_detail');
            }}
            onAddIssue={handleAddIssue}
            onOpenIssue={handleOpenIssue}
            onSaveIssues={handleSaveIssues}
            onReorderIssues={handleReorderIssues}
          />
        )}

        {activeScreen === 'issue_detail' && activeReport && activeIssue && (
          <IssueDetailScreen
            report={activeReport}
            issue={activeIssue}
            photos={activeIssuePhotos}
            draft={issueDrafts[activeIssue.id]}
            onDraftChange={draft => handleUpdateIssueDraft(activeIssue.id, draft)}
            onBack={() => setActiveScreen('issues_list')}
            onSaveIssue={handleSaveIssue}
            onDeleteIssue={handleDeleteIssue}
            onOpenPhoto={handleOpenPhoto}
            onPhotosUpdated={() => {
              if (activeIssue) refreshActiveIssuePhotos(activeIssue.id);
              if (activeReport) refreshActiveReportIssues(activeReport.id);
            }}
            onReorderPhotos={handleReorderPhotos}
          />
        )}

        {activeScreen === 'photo_detail' && activeReport && activeIssue && activePhoto && (
          <PhotoDetailScreen
            report={activeReport}
            issue={activeIssue}
            photo={activePhoto}
            photos={activeIssuePhotos}
            issues={activeReportIssues}
            onBack={() => setActiveScreen('issue_detail')}
            onSelectPhoto={handleOpenPhoto}
            onSavePhoto={handleSavePhoto}
            onDeletePhoto={handleDeletePhoto}
          />
        )}
      </main>

      {/* Floating Offline & Reconnect Connectivity Indicator */}
      <OfflineIndicator
        isOnline={isOnline}
        wasOffline={wasOffline}
        onClearWasOffline={clearWasOffline}
        pendingSyncCount={pendingSyncCount}
        isSyncing={isManualSyncing}
      />
    </div>
  );
}
