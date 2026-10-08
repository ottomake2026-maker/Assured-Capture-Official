import React, { useState, useRef, useEffect } from 'react';
import { UserProfile, Report } from '../types';
import { ConfirmationDialog } from './ConfirmationDialog';
import { logout, initAuth, auth } from '../utils/firebaseAuth';
import { checkMyAuthStatus } from '../utils/adminApi';
import { deleteUser } from 'firebase/auth';
import {
  ArrowLeft,
  Camera,
  Upload,
  Trash2,
  RefreshCw,
  Users,
  ChevronRight,
  Check,
  LogOut,
  LogIn,
  CheckCircle2,
  AlertCircle,
  Cloud,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import {
  syncLocalDataToFirestore,
  getLastFirestoreSyncTime,
  formatSyncTime,
} from '../utils/firestoreSync';
import { isFirestoreQuotaExhausted, subscribeToQuotaStatus, fetchUserProfileFromFirestore } from '../db/storage';
import { optimizeAvatarImage } from '../utils/avatarUtils';

interface UserProfileScreenProps {
  profile: UserProfile;
  reports: Report[];
  onBack: () => void;
  onSaveProfile: (updated: UserProfile) => Promise<UserProfile | boolean | void> | void;
  onSignOut: () => void;
  onRequestSignIn?: () => void;
  onOpenAdminUsers?: () => void;
  isGuest?: boolean;
  onSyncComplete?: () => Promise<void> | void;
}

function getInitials(name: string, email: string): string {
  const cleanName = (name || '').trim();
  if (cleanName) {
    const parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return cleanName.slice(0, 2).toUpperCase();
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return 'U';
}

export const UserProfileScreen: React.FC<UserProfileScreenProps> = ({
  profile,
  reports,
  onBack,
  onSaveProfile,
  onSignOut,
  onRequestSignIn,
  onOpenAdminUsers,
  isGuest,
  onSyncComplete,
}) => {
  const isGuestMode = isGuest || !auth.currentUser;
  const [currentUser, setCurrentUser] = useState<any>(auth.currentUser);
  const [serverRole, setServerRole] = useState<string>(profile.role || '');

  useEffect(() => {
    if (auth.currentUser && !isGuestMode) {
      checkMyAuthStatus()
        .then((res) => {
          if (res?.role) setServerRole(res.role);
        })
        .catch(() => {
          // Ignore error in offline or non-admin context
        });
    }
  }, [isGuestMode]);

  const userEmail = (auth.currentUser?.email || profile.email || '').toLowerCase();
  const isAdminRole = !isGuestMode && (
    userEmail === 'ottomake2026@gmail.com' ||
    profile.role === 'Administrator' ||
    serverRole === 'Administrator'
  );

  // Profile fields state
  const [profileName, setProfileName] = useState<string>(
    isGuestMode ? '' : (profile.profileName || profile.fullName || profile.name || profile.displayName || '')
  );
  const [avatarUrl, setAvatarUrl] = useState<string>(
    isGuestMode ? '' : (profile.avatarUrl || profile.photoURL || '')
  );
  const [email, setEmail] = useState<string>(
    isGuestMode ? '' : (profile.email || auth.currentUser?.email || '')
  );

  // Bottom sheet modal state for avatar
  const [showPhotoSheet, setShowPhotoSheet] = useState(false);

  // Sync state with incoming props and auth changes
  useEffect(() => {
    if (!auth.currentUser || isGuest) {
      setProfileName('');
      setAvatarUrl('');
      setEmail('');
    } else {
      setProfileName(profile.profileName || profile.fullName || profile.name || auth.currentUser?.displayName || '');
      setAvatarUrl(profile.avatarUrl || profile.photoURL || auth.currentUser?.photoURL || '');
      setEmail(profile.email || auth.currentUser?.email || '');
    }
  }, [profile, isGuest]);

  // Load authoritative profile data from the authenticated account whenever Profile Settings opens
  useEffect(() => {
    let isMounted = true;
    const uid = auth.currentUser?.uid;
    if (uid && !isGuest) {
      fetchUserProfileFromFirestore(uid).then((fresh) => {
        if (fresh && isMounted) {
          const freshName = fresh.profileName || fresh.fullName || fresh.name || '';
          if (freshName) setProfileName(freshName);
          if (fresh.avatarUrl || fresh.photoURL) setAvatarUrl(fresh.avatarUrl || fresh.photoURL || '');
          if (fresh.email) setEmail(fresh.email);
        }
      }).catch((err) => {
        console.warn('Notice loading fresh profile from account:', err);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [isGuest]);

  // Profile save feedback and loading states
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Avatar upload and compression states
  const [isOptimizingAvatar, setIsOptimizingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Data & sync states
  const [lastFirestoreSyncTime, setLastFirestoreSyncTime] = useState<string | null>(getLastFirestoreSyncTime());
  const [quotaExhausted, setQuotaExhausted] = useState<boolean>(isFirestoreQuotaExhausted());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Subscribe to quota status changes
  useEffect(() => {
    const unsub = subscribeToQuotaStatus((exhausted) => {
      setQuotaExhausted(exhausted);
    });
    return () => unsub();
  }, []);

  // Account deletion dialog state
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth((user) => {
      setCurrentUser(user);
      if (user) {
        setEmail(user.email || '');
        if (user.displayName) {
          if (!profileName) setProfileName(user.displayName);
        }
        if (user.photoURL) {
          if (!avatarUrl) setAvatarUrl(user.photoURL);
        }
      } else {
        setProfileName('');
        setAvatarUrl('');
        setEmail('');
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Handle Photo upload / file select for profile picture
  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isSaving || isOptimizingAvatar) return;

    const previousAvatar = avatarUrl;
    setIsOptimizingAvatar(true);
    setAvatarError(null);

    try {
      const optimized = await optimizeAvatarImage(file, 256, 0.85);
      setAvatarUrl(optimized);

      // If user is authenticated, directly synchronize and save to account profile
      if (currentUser && currentUser.uid) {
        const cleanProfileName = profileName.trim() || profile.profileName || profile.name || '';
        const canonicalName = cleanProfileName || 'User Profile';
        const updatedProfile: UserProfile = {
          userId: currentUser.uid,
          profileName: cleanProfileName,
          displayName: cleanProfileName,
          name: canonicalName,
          fullName: cleanProfileName,
          avatarUrl: optimized,
          photoURL: optimized,
          avatarStorageUri: `gs://assured-capture-storage/users/${currentUser.uid}/avatar.jpg`,
          email: email.trim() || currentUser.email || '',
          role: profile.role || '',
          accountType: 'authenticated',
          updatedAt: new Date().toISOString(),
        };

        await onSaveProfile(updatedProfile);
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    } catch (err: any) {
      console.error('Avatar upload/save error:', err);
      setAvatarUrl(previousAvatar);
      setAvatarError(err?.message || 'Failed to process picture. Please try again.');
    } finally {
      setIsOptimizingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    if (isSaving || isOptimizingAvatar) return;
    const previousAvatar = avatarUrl;
    setAvatarUrl('');
    setAvatarError(null);

    if (currentUser && currentUser.uid) {
      try {
        const cleanProfileName = profileName.trim() || profile.profileName || profile.name || '';
        const canonicalName = cleanProfileName || 'User Profile';
        const updatedProfile: UserProfile = {
          userId: currentUser.uid,
          profileName: cleanProfileName,
          displayName: cleanProfileName,
          name: canonicalName,
          fullName: cleanProfileName,
          avatarUrl: '',
          photoURL: null,
          avatarStorageUri: '',
          email: email.trim() || currentUser.email || '',
          role: profile.role || '',
          accountType: 'authenticated',
          updatedAt: new Date().toISOString(),
        };

        await onSaveProfile(updatedProfile);
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      } catch (err: any) {
        console.error('Avatar removal error:', err);
        setAvatarUrl(previousAvatar);
        setAvatarError('Failed to remove picture. Please try again.');
      }
    }
  };

  // Handle Sign out
  const handleSignOut = async () => {
    try {
      await logout();
      onSignOut();
    } catch (err: any) {
      console.error('Sign out error:', err);
      onSignOut();
    }
  };

  // Handle Profile Save
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving || isOptimizingAvatar) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSavedSuccess(false);

    const cleanProfileName = profileName.trim();
    const canonicalName = cleanProfileName || 'User Profile';

    const updatedProfile: UserProfile = {
      userId: currentUser ? currentUser.uid : null,
      profileName: cleanProfileName,
      displayName: cleanProfileName,
      name: canonicalName,
      fullName: cleanProfileName,
      avatarUrl: avatarUrl.trim(),
      photoURL: avatarUrl.trim() || null,
      avatarStorageUri: avatarUrl.trim() && currentUser?.uid ? `gs://assured-capture-storage/users/${currentUser.uid}/avatar.jpg` : '',
      email: email.trim() || (currentUser?.email || ''),
      role: currentUser ? (profile.role || '') : '',
      accountType: currentUser ? 'authenticated' : 'guest',
      updatedAt: new Date().toISOString(),
    };

    try {
      await onSaveProfile(updatedProfile);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      console.error('Save profile failed:', err);
      setSaveError(err?.message || 'Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Manual Sync
  const handleSyncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await syncLocalDataToFirestore();
      setLastFirestoreSyncTime(getLastFirestoreSyncTime());
      if (onSyncComplete) {
        await onSyncComplete();
      }
      if (res.stage === 'error') {
        setSyncMessage(res.errorMessage || 'Sync completed with notice');
      }
    } catch (err: any) {
      console.error('Manual sync error:', err);
      setSyncMessage(err?.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle Account Deletion
  const handleConfirmDeleteAccount = async () => {
    if (!currentUser) return;
    setIsDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      await deleteUser(currentUser);
      onSignOut();
    } catch (err: any) {
      console.error('Account deletion error:', err);
      setDeleteAccountError(
        err?.code === 'auth/requires-recent-login'
          ? 'For security, please sign out and sign back in, then retry deleting your account.'
          : (err?.message || 'Could not delete account. Please try signing out and back in.')
      );
      setShowDeleteAccountModal(false);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const displayName = profileName || profile.profileName || profile.fullName || profile.name || currentUser?.displayName || '';
  const displayEmail = email || currentUser?.email || '';
  const roleLabel = isAdminRole
    ? 'Administrator'
    : currentUser
    ? (serverRole || profile.role || 'Member')
    : 'Guest';

  return (
    <div id="user_profile_screen" className="min-h-screen bg-[#F4F4F2] pb-16">
      {/* Hidden file inputs for bottom sheet actions */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={handleAvatarFileChange}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarFileChange}
        className="hidden"
      />

      <div className="max-w-xl mx-auto px-4 sm:px-6 pt-3 space-y-5">
        {/* 1. Header: back arrow + title "Account & Settings", one line */}
        <header className="flex items-center gap-2 py-1">
          <button
            type="button"
            id="btn_profile_back"
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg text-[#1D2421] hover:bg-[#EAECEF] active:bg-[#DFE2E6] transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <h1 className="text-[20px] font-semibold text-[#1D2421] tracking-tight">
            Account &amp; Settings
          </h1>
        </header>

        {/* 2. Profile header (no card): 72px circular avatar showing initials by default,
            name (20px semibold), email (14px gray), small role pill */}
        <div className="flex flex-col items-center text-center pt-1 pb-2">
          {/* Avatar - tap opens bottom sheet */}
          <button
            type="button"
            onClick={() => setShowPhotoSheet(true)}
            className="w-[72px] h-[72px] rounded-full overflow-hidden bg-[#E2E8F0] border-2 border-white shadow-xs flex items-center justify-center cursor-pointer relative group transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#D9480F]/30"
            aria-label="Profile photo options"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName || 'Profile photo'}
                className="w-full h-full object-cover"
                onError={() => setAvatarUrl('')}
              />
            ) : (
              <span className="text-[22px] font-semibold text-[#4B5563] tracking-wide select-none">
                {getInitials(displayName, displayEmail)}
              </span>
            )}

            {isOptimizingAvatar && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center text-white">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
            )}
          </button>

          <h2 className="text-[20px] font-semibold text-[#1D2421] mt-3 tracking-tight">
            {displayName || (currentUser ? 'User' : 'Guest')}
          </h2>

          <p className="text-[14px] text-[#6B7280] mt-0.5">
            {displayEmail || (currentUser ? 'No email attached' : 'Stored locally on this device')}
          </p>

          <div className="mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-[#EAECEF] text-[#374151]">
            {roleLabel}
          </div>

          {avatarError && (
            <div className="text-[13px] text-rose-600 font-medium flex items-center gap-1 mt-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{avatarError}</span>
            </div>
          )}
        </div>

        {/* 3. Grouped section: PROFILE */}
        <section className="space-y-1.5">
          <h3 className="text-[13px] font-medium text-[#6B7280] px-3">
            Profile
          </h3>
          <div className="bg-white rounded-[12px] border border-[#E5E7EA] divide-y divide-[#E5E7EA] overflow-hidden">
            {/* Profile Name row with inline editing and primary action */}
            <form onSubmit={handleSave} className="min-h-[56px] px-4 py-2 flex items-center justify-between gap-3">
              <label htmlFor="input_profile_name" className="text-[16px] text-[#1D2421] font-medium shrink-0 min-w-[70px]">
                Name
              </label>
              <input
                type="text"
                id="input_profile_name"
                value={profileName}
                disabled={isSaving || isOptimizingAvatar}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder={currentUser ? 'e.g. Sarah Jenkins' : 'Enter profile name'}
                className="flex-1 text-right text-[16px] text-[#1D2421] bg-transparent focus:outline-none focus:text-[#1D2421] placeholder:text-[#9CA3AF] min-h-[44px]"
              />
              <button
                type="submit"
                id="btn_save_profile"
                disabled={isSaving || isOptimizingAvatar}
                className="px-3.5 py-1.5 bg-[#D9480F] hover:bg-[#C23E0C] active:bg-[#AA360A] text-white text-[14px] font-medium rounded-[8px] transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 disabled:opacity-50"
              >
                {isSaving ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <span>Save</span>
                )}
              </button>
            </form>

            {/* Account Email row (read-only) */}
            <div className="min-h-[56px] px-4 py-2.5 flex items-center justify-between gap-3">
              <span className="text-[16px] text-[#1D2421] font-medium shrink-0 min-w-[70px]">
                Email
              </span>
              <input
                type="email"
                id="input_account_email"
                value={displayEmail || 'None'}
                readOnly
                disabled
                aria-readonly="true"
                className="flex-1 text-right text-[16px] text-[#6B7280] bg-transparent cursor-default select-all outline-none"
              />
            </div>
          </div>

          {savedSuccess && (
            <div className="px-3 py-1 flex items-center gap-1.5 text-[13px] text-emerald-700 font-medium animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Profile updated</span>
            </div>
          )}

          {saveError && (
            <div className="px-3 py-1 flex items-center gap-1.5 text-[13px] text-rose-600 font-medium animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
        </section>

        {/* 4. Grouped section: DATA & SYNC */}
        <section className="space-y-1.5">
          <h3 className="text-[13px] font-medium text-[#6B7280] px-3">
            Data &amp; sync
          </h3>
          <div className="bg-white rounded-[12px] border border-[#E5E7EA] divide-y divide-[#E5E7EA] overflow-hidden">
            {/* Sync status row */}
            <div className="min-h-[56px] px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[16px] text-[#1D2421] font-medium">
                  Cloud sync
                </span>
                <span className="text-[13px] text-[#6B7280]">
                  {quotaExhausted ? 'Offline safe mode' : formatSyncTime(lastFirestoreSyncTime)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleSyncNow}
                disabled={isSyncing}
                className="px-3.5 py-1.5 text-[14px] font-medium text-[#D9480F] hover:bg-[#FFF5F2] active:bg-[#FFE8E0] rounded-[8px] transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync now'}</span>
              </button>
            </div>

            {/* Reports stored */}
            <div className="min-h-[56px] px-4 py-2.5 flex items-center justify-between gap-3">
              <span className="text-[16px] text-[#1D2421]">
                Reports stored
              </span>
              <span className="text-[16px] text-[#6B7280]">
                {reports.length}
              </span>
            </div>

            {/* App installation / PWA */}
            <div className="min-h-[56px] px-4 py-2 flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[16px] text-[#1D2421]">
                  App installation
                </span>
                <span className="text-[13px] text-[#6B7280]">
                  Install for offline home screen access
                </span>
              </div>
              <div className="shrink-0">
                <PWAInstallButton variant="button" />
              </div>
            </div>
          </div>

          {syncMessage && (
            <div className="px-3 py-1 flex items-center gap-1.5 text-[13px] text-[#6B7280] font-medium animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{syncMessage}</span>
            </div>
          )}
        </section>

        {/* 5. Grouped section: ADMINISTRATION (admin only) */}
        {onOpenAdminUsers && isAdminRole && (
          <section className="space-y-1.5">
            <h3 className="text-[13px] font-medium text-[#6B7280] px-3">
              Administration
            </h3>
            <div className="bg-white rounded-[12px] border border-[#E5E7EA] divide-y divide-[#E5E7EA] overflow-hidden">
              <button
                type="button"
                id="btn_profile_open_admin"
                onClick={onOpenAdminUsers}
                className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-[#F9FAFB] active:bg-[#F3F4F6] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#FFF5F2] text-[#D9480F] flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 stroke-[2.2]" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[16px] text-[#1D2421] font-medium">
                      Admin users
                    </span>
                    <span className="text-[13px] text-[#6B7280]">
                      Manage team accounts and permissions
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#9CA3AF] shrink-0" />
              </button>
            </div>
          </section>
        )}

        {/* 6. Grouped section: ACCOUNT */}
        <section className="space-y-1.5">
          <h3 className="text-[13px] font-medium text-[#6B7280] px-3">
            Account
          </h3>
          <div className="bg-white rounded-[12px] border border-[#E5E7EA] divide-y divide-[#E5E7EA] overflow-hidden">
            {currentUser ? (
              <>
                {/* Sign out row */}
                <button
                  type="button"
                  id="btn_profile_signout"
                  onClick={handleSignOut}
                  className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between text-left hover:bg-[#F9FAFB] active:bg-[#F3F4F6] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <LogOut className="w-5 h-5 text-[#6B7280] shrink-0" />
                    <span className="text-[16px] text-[#1D2421] font-medium">
                      Sign out
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#9CA3AF] shrink-0" />
                </button>

                {/* Delete account row */}
                <button
                  type="button"
                  id="btn_delete_account_trigger"
                  onClick={() => setShowDeleteAccountModal(true)}
                  className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between text-left hover:bg-rose-50/50 active:bg-rose-100/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Trash2 className="w-5 h-5 text-[#DC2626] shrink-0" />
                    <span className="text-[16px] text-[#DC2626] font-medium">
                      Delete account
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-rose-300 shrink-0" />
                </button>
              </>
            ) : (
              <>
                {/* Sign in row */}
                {onRequestSignIn && (
                  <button
                    type="button"
                    id="btn_profile_link_account"
                    onClick={onRequestSignIn}
                    className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between text-left hover:bg-[#F9FAFB] active:bg-[#F3F4F6] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <LogIn className="w-5 h-5 text-[#D9480F] shrink-0" />
                      <span className="text-[16px] text-[#D9480F] font-medium">
                        Sign in
                      </span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#9CA3AF] shrink-0" />
                  </button>
                )}

                {/* Exit guest mode row */}
                <button
                  type="button"
                  id="btn_profile_exit_guest"
                  onClick={onSignOut}
                  className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between text-left hover:bg-[#F9FAFB] active:bg-[#F3F4F6] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <LogOut className="w-5 h-5 text-[#6B7280] shrink-0" />
                    <span className="text-[16px] text-[#1D2421] font-medium">
                      Exit guest mode
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#9CA3AF] shrink-0" />
                </button>
              </>
            )}
          </div>

          {deleteAccountError && (
            <div className="px-3 py-1 flex items-center gap-1.5 text-[13px] text-rose-600 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{deleteAccountError}</span>
            </div>
          )}
        </section>
      </div>

      {/* Bottom Sheet for Avatar Photo Options */}
      {showPhotoSheet && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setShowPhotoSheet(false)}
        >
          <div
            className="bg-white rounded-t-[20px] p-4 max-w-lg mx-auto w-full space-y-2 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center py-1 text-[13px] font-medium text-[#6B7280]">
              Profile photo
            </div>

            <div className="bg-[#F4F4F2] rounded-[12px] divide-y divide-[#E5E7EA] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setShowPhotoSheet(false);
                  cameraInputRef.current?.click();
                }}
                className="w-full min-h-[56px] px-4 flex items-center justify-center gap-2.5 text-[16px] text-[#1D2421] font-medium hover:bg-[#EAECEF] active:bg-[#DFE2E6] transition-colors cursor-pointer"
              >
                <Camera className="w-5 h-5 text-[#1D2421]" />
                <span>Take photo</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowPhotoSheet(false);
                  fileInputRef.current?.click();
                }}
                className="w-full min-h-[56px] px-4 flex items-center justify-center gap-2.5 text-[16px] text-[#1D2421] font-medium hover:bg-[#EAECEF] active:bg-[#DFE2E6] transition-colors cursor-pointer"
              >
                <Upload className="w-5 h-5 text-[#1D2421]" />
                <span>Choose photo</span>
              </button>

              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPhotoSheet(false);
                    handleRemoveAvatar();
                  }}
                  className="w-full min-h-[56px] px-4 flex items-center justify-center gap-2.5 text-[16px] text-[#DC2626] font-medium hover:bg-rose-50 active:bg-rose-100 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-5 h-5 text-[#DC2626]" />
                  <span>Remove photo</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowPhotoSheet(false)}
              className="w-full min-h-[56px] px-4 bg-[#F4F4F2] hover:bg-[#EAECEF] active:bg-[#DFE2E6] text-[#1D2421] text-[16px] font-semibold rounded-[12px] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Account Deletion Confirmation Modal */}
      <ConfirmationDialog
        isOpen={showDeleteAccountModal}
        title="Delete Account"
        message="Permanently delete your account and all stored reports?"
        confirmLabel="Delete Account"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isDeletingAccount}
        onConfirm={handleConfirmDeleteAccount}
        onCancel={() => setShowDeleteAccountModal(false)}
      />
    </div>
  );
};
