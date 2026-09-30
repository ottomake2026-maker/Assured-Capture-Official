import React, { useState, useRef, useEffect } from 'react';
import { UserProfile, Report } from '../types';
import { AssuredLogo } from './AssuredLogo';
import { ConfirmationDialog } from './ConfirmationDialog';
import { logout, initAuth, auth } from '../utils/firebaseAuth';
import { deleteUser } from 'firebase/auth';
import {
  ArrowLeft,
  Camera,
  Upload,
  User as UserIcon,
  Check,
  AlertCircle,
  LogOut,
  RefreshCw,
  Mail,
  ShieldCheck,
  Key,
  Database,
  Trash2,
  CheckCircle2,
  Smartphone,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { isFirestoreQuotaExhausted, subscribeToQuotaStatus, fetchUserProfileFromFirestore } from '../db/storage';
import { optimizeAvatarImage } from '../utils/avatarUtils';

interface UserProfileScreenProps {
  profile: UserProfile;
  reports: Report[];
  onBack: () => void;
  onSaveProfile: (updated: UserProfile) => Promise<UserProfile | boolean | void> | void;
  onSignOut: () => void;
  isGuest?: boolean;
  onSyncComplete?: () => Promise<void> | void;
  onOpenAdminUsers?: () => void;
}

export const UserProfileScreen: React.FC<UserProfileScreenProps> = ({
  profile,
  reports,
  onBack,
  onSaveProfile,
  onSignOut,
  isGuest,
  onOpenAdminUsers,
}) => {
  const [currentUser, setCurrentUser] = useState<any>(auth.currentUser);

  // Profile Name field
  const [profileName, setProfileName] = useState<string>(
    profile.profileName || profile.fullName || profile.name || profile.displayName || ''
  );
  const [avatarUrl, setAvatarUrl] = useState<string>(
    profile.avatarUrl || profile.photoURL || ''
  );
  const [email, setEmail] = useState<string>(
    auth.currentUser?.email || profile.email || ''
  );

  // Sync state with incoming props and auth changes
  useEffect(() => {
    if (auth.currentUser) {
      setProfileName(profile.profileName || profile.fullName || profile.name || auth.currentUser.displayName || '');
      setAvatarUrl(profile.avatarUrl || profile.photoURL || auth.currentUser.photoURL || '');
      setEmail(auth.currentUser.email || profile.email || '');
    } else {
      setProfileName(profile.profileName || profile.fullName || profile.name || '');
      setAvatarUrl(profile.avatarUrl || profile.photoURL || '');
      setEmail('');
    }
  }, [profile, isGuest]);

  // Load authoritative profile data from the authenticated account whenever Profile Settings opens
  useEffect(() => {
    let isMounted = true;
    const uid = auth.currentUser?.uid;
    if (uid) {
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
  }, []);

  // Profile save feedback and loading states
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Avatar upload and compression states
  const [isOptimizingAvatar, setIsOptimizingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [quotaExhausted, setQuotaExhausted] = useState<boolean>(isFirestoreQuotaExhausted());

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

  // Initialize Auth listener on mount to always reflect the true Firebase Auth state
  useEffect(() => {
    const unsubscribe = initAuth((user) => {
      setCurrentUser(user);
      if (user) {
        setEmail(user.email || '');
        if (user.displayName && !profileName) {
          setProfileName(user.displayName);
        }
        if (user.photoURL && !avatarUrl) {
          setAvatarUrl(user.photoURL);
        }
      } else {
        setEmail('');
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [profileName, avatarUrl]);

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
      setAvatarError(err?.message || 'Failed to process and save selected picture. Please try again.');
    } finally {
      setIsOptimizingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
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
        setAvatarError('Failed to remove picture from your account. Please try again.');
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
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setTimeout(() => setSavedSuccess(false), 4000);
    } catch (err: any) {
      console.error('Save profile failed:', err);
      setSaveError(err?.message || 'Failed to save profile changes to your account. Please check your connection and try again.');
    } finally {
      setIsSaving(false);
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
          ? 'For security, please sign in via your access link again before deleting your account.'
          : (err?.message || 'Could not delete account. Please try requesting a new access link.')
      );
      setShowDeleteAccountModal(false);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const signInMethod = currentUser
    ? 'Email Link (Passwordless)'
    : 'Admin-Issued Access Link';

  const sessionStatus = currentUser
    ? 'Authenticated'
    : 'No Active Session';

  return (
    <div id="user_profile_screen" className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[#0E1E2B]/10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            id="btn_profile_back"
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-[#F4F6F8] text-[#0E1E2B] transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Back to reports"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-brand font-bold tracking-tight text-[#0E1E2B]">
              Account &amp; Settings
            </h1>
          </div>
        </div>

        <div className="hidden sm:block">
          <AssuredLogo />
        </div>
      </div>

      {/* 1. SECTION: PROFILE · PERSONAL INFORMATION */}
      <section className="space-y-2.5">
        <div className="px-1 flex items-center justify-between">
          <h2 className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-[#0E1E2B]/70">
            PROFILE · PERSONAL INFORMATION
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
              currentUser
                ? 'text-[#0E1E2B] bg-[#B2E5F6]/40 border-[#0E1E2B]/15'
                : 'text-[#0E1E2B]/70 bg-white border-[#0E1E2B]/15'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                currentUser ? 'bg-[#0E1E2B]' : 'bg-[#E11D48]'
              }`}
            />
            <span>{currentUser ? 'Authenticated' : 'Local Storage Mode'}</span>
          </span>
        </div>

        <div className="bg-white border border-[#0E1E2B]/15 rounded-xl shadow-2xs p-5 sm:p-7">
          <form onSubmit={handleSave} className="space-y-6">
            {/* Avatar Row */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="relative group">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-[#0E1E2B]/15 bg-[#F4F6F8] shadow-inner flex items-center justify-center relative">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={profileName || 'Profile photo'}
                      className="w-full h-full object-cover"
                      onError={() => setAvatarUrl('')}
                    />
                  ) : (
                    <UserIcon className="w-12 h-12 text-[#0E1E2B]/35" />
                  )}
                  {isOptimizingAvatar && (
                    <div className="absolute inset-0 bg-[#0E1E2B]/60 backdrop-blur-[2px] flex items-center justify-center text-white">
                      <RefreshCw className="w-6 h-6 animate-spin text-white" />
                    </div>
                  )}
                </div>
                {currentUser && !isOptimizingAvatar && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute -bottom-2 -right-2 p-2 bg-[#0E1E2B] hover:bg-[#1A2E3D] text-white rounded-lg shadow-md border-2 border-white transition-transform group-hover:scale-105 cursor-pointer"
                    title="Change profile photo"
                    aria-label="Upload photo"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileChange}
                  className="hidden"
                />
              </div>

              <div className="flex-1 text-center sm:text-left space-y-1.5">
                <h3 className="text-base font-brand font-bold text-[#0E1E2B] tracking-wide">
                  {currentUser ? (profileName || profile.profileName || profile.name || 'Authenticated User') : (profileName || 'Inspector Profile')}
                </h3>
                <p className="text-xs text-[#0E1E2B]/60">
                  {currentUser ? (email || currentUser.email || 'No email attached') : 'Local Device Mode'}
                </p>
                {currentUser && (
                  <div className="pt-2 flex flex-wrap gap-2 justify-center sm:justify-start">
                    <button
                      type="button"
                      disabled={isSaving || isOptimizingAvatar}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#F4F6F8] hover:bg-[#EAEFF4] text-[#0E1E2B] text-xs font-bold rounded-lg border border-[#0E1E2B]/15 transition-all cursor-pointer disabled:opacity-50 min-h-[38px]"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isOptimizingAvatar ? 'Processing...' : 'Upload Picture'}</span>
                    </button>
                    {avatarUrl && (
                      <button
                        type="button"
                        disabled={isSaving || isOptimizingAvatar}
                        onClick={handleRemoveAvatar}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-600 text-xs font-bold rounded-lg border border-rose-200 transition-all cursor-pointer disabled:opacity-50 min-h-[38px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove Picture</span>
                      </button>
                    )}
                  </div>
                )}
                {avatarError && (
                  <div className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1 justify-center sm:justify-start">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{avatarError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Editable Fields - Single Profile Name & Read-Only Email */}
            <div className="space-y-4 pt-4 border-t border-[#0E1E2B]/10">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0E1E2B]">
                  Profile Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-[#0E1E2B]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    id="input_profile_name"
                    value={profileName}
                    disabled={isSaving || isOptimizingAvatar}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="e.g. Inspector Name"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-xs sm:text-sm text-[#0E1E2B] focus:outline-none focus:ring-2 focus:ring-[#628EF7]/20 focus:border-[#628EF7] transition-all min-h-[44px] disabled:bg-[#F4F6F8]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0E1E2B]">
                  Account Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#0E1E2B]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    id="input_account_email"
                    value={email || (currentUser?.email || '')}
                    readOnly
                    disabled
                    aria-readonly="true"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-[#F4F6F8] border border-[#0E1E2B]/15 rounded-lg text-xs sm:text-sm text-[#0E1E2B]/70 cursor-not-allowed select-none min-h-[44px]"
                  />
                </div>
              </div>
            </div>

            {/* Stable User Identifier */}
            <div className="p-3.5 bg-[#F4F6F8] rounded-lg border border-[#0E1E2B]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#0E1E2B]/60 font-mono">
                  Stable Account Identifier (UID)
                </div>
                <div className="font-mono text-xs text-[#0E1E2B] font-semibold break-all">
                  {currentUser?.uid || 'None'}
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#0E1E2B]/50 bg-white px-2.5 py-1 rounded-md border border-[#0E1E2B]/15 self-start sm:self-auto">
                {currentUser ? 'Authoritative Key' : 'Local Session'}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                id="btn_save_profile"
                disabled={isSaving || isOptimizingAvatar}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all touch-manipulation cursor-pointer min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Profile</span>
                  </>
                )}
              </button>
            </div>

            {savedSuccess && (
              <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-950 bg-emerald-50 px-3.5 py-2.5 rounded-lg border border-emerald-200 animate-in fade-in w-full justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Profile updated</span>
              </div>
            )}

            {saveError && (
              <div className="inline-flex items-center gap-2 text-xs font-bold text-rose-900 bg-rose-50 px-3.5 py-2.5 rounded-lg border border-rose-200 animate-in fade-in w-full justify-center">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}
          </form>
        </div>
      </section>

      {/* ADMIN PORTAL SECTION (Only displayed if role is admin or primary administrator) */}
      {(profile.role === 'admin' || (currentUser?.email && currentUser.email.toLowerCase() === 'ottomake2026@gmail.com')) && (
        <section className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <h2 className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-[#628EF7]">
              ADMINISTRATION &amp; ACCESS MANAGEMENT
            </h2>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider bg-[#628EF7] text-white px-2 py-0.5 rounded">
              ADMIN ROLE ACTIVE
            </span>
          </div>

          <div className="bg-[#B2E5F6]/25 border border-[#628EF7]/40 rounded-xl p-5 sm:p-6 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#628EF7]" />
                  <h3 className="text-base font-brand font-bold text-[#0E1E2B]">
                    Admin Portal · Users Management
                  </h3>
                </div>
                <p className="text-xs text-[#0E1E2B]/70">
                  Authorize team members, review access status, and manage active/disabled accounts.
                </p>
              </div>

              {onOpenAdminUsers && (
                <button
                  type="button"
                  onClick={onOpenAdminUsers}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#0E1E2B] hover:bg-[#1A2E3D] active:bg-[#07131D] text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all touch-manipulation cursor-pointer min-h-[44px] shrink-0"
                >
                  <Key className="w-4 h-4 text-[#B2E5F6]" />
                  <span>Open Admin Users</span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 2. SECTION: DATA / REPORTS · STORAGE & SYNC */}
      <section className="space-y-2.5">
        <div className="px-1">
          <h2 className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-[#0E1E2B]/70">
            DATA / REPORTS · STORAGE &amp; SYNC
          </h2>
        </div>

        <div className="bg-white border border-[#0E1E2B]/15 rounded-xl shadow-2xs p-5 sm:p-7 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[#B2E5F6]/40 border border-[#B2E5F6] text-[#0E1E2B]">
                <Database className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="text-base font-brand font-bold text-[#0E1E2B]">
                  Assured Capture Cloud Database
                </h3>
              </div>
            </div>
            {quotaExhausted ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-300 shrink-0">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span>Offline Safe Mode</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-[#0E1E2B] bg-[#B2E5F6]/40 px-2.5 py-1 rounded-md border border-[#0E1E2B]/15 shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-[#0E1E2B]" />
                <span>Authoritative</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="p-3.5 bg-[#F4F6F8] rounded-xl border border-[#0E1E2B]/10">
              <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">Reports Saved</div>
              <div className="text-xl font-bold font-mono text-[#0E1E2B] mt-0.5">{reports.length}</div>
            </div>
            <div className="p-3.5 bg-[#F4F6F8] rounded-xl border border-[#0E1E2B]/10">
              <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">Storage Engine</div>
              <div className="text-xs font-bold text-[#0E1E2B] mt-1.5">Cloud Firestore + Local IndexedDB</div>
            </div>
            <div className="p-3.5 bg-[#F4F6F8] rounded-xl border border-[#0E1E2B]/10">
              <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">Data Security</div>
              <div className="text-xs font-bold text-[#0E1E2B] mt-1.5">User-Owned Rule Enforcement</div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. SECTION: OFFLINE STORAGE & DEVICE INSTALLATION (PWA) */}
      <section className="space-y-2.5">
        <div className="px-1">
          <h2 className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-[#0E1E2B]/70">
            OFFLINE STORAGE &amp; DEVICE INSTALLATION
          </h2>
        </div>

        <div className="bg-white border border-[#0E1E2B]/15 rounded-xl shadow-2xs p-5 sm:p-7 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-[#F4F6F8] rounded-xl border border-[#0E1E2B]/10 space-y-1">
              <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">
                Offline Resilience
              </div>
              <div className="text-sm font-bold text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>100% Offline-Ready</span>
              </div>
            </div>

            <div className="p-4 bg-[#F4F6F8] rounded-xl border border-[#0E1E2B]/10 space-y-1">
              <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">
                App Installation
              </div>
              <div className="text-sm font-bold text-[#0E1E2B] flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[#628EF7]" />
                <span>Progressive Web App (PWA)</span>
              </div>
            </div>
          </div>

          <PWAInstallButton variant="button" />
        </div>
      </section>

      {/* 4. SECTION: ACCOUNT & SECURITY */}
      <section className="space-y-2.5">
        <div className="px-1">
          <h2 className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-[#0E1E2B]/70">
            ACCOUNT &amp; SECURITY
          </h2>
        </div>

        <div className="bg-white border border-[#0E1E2B]/15 rounded-xl shadow-2xs p-5 sm:p-7 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-[#F4F6F8] rounded-xl border border-[#0E1E2B]/10 space-y-1">
              <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">
                Sign-In Method
              </div>
              <div className="text-sm font-bold text-[#0E1E2B] flex items-center gap-2">
                <Key className="w-4 h-4 text-[#0E1E2B]" />
                <span>{signInMethod}</span>
              </div>
            </div>

            <div className="p-4 bg-[#F4F6F8] rounded-xl border border-[#0E1E2B]/10 space-y-1">
              <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">
                Session Status
              </div>
              <div className="text-sm font-bold text-[#0E1E2B] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0E1E2B]" />
                <span>{sessionStatus}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-[#0E1E2B]/10">
            {currentUser ? (
              <>
                <button
                  type="button"
                  id="btn_profile_signout"
                  onClick={handleSignOut}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white hover:bg-[#F4F6F8] text-[#0E1E2B] border border-[#0E1E2B]/20 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[44px]"
                >
                  <LogOut className="w-4 h-4 text-[#0E1E2B]" />
                  <span>Sign Out</span>
                </button>

                <button
                  type="button"
                  id="btn_delete_account_trigger"
                  onClick={() => setShowDeleteAccountModal(true)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-rose-700 hover:bg-rose-50 text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Account</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                id="btn_profile_back_to_reports"
                onClick={onBack}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer min-h-[44px]"
              >
                <span>Back to Reports</span>
              </button>
            )}
          </div>

          {deleteAccountError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{deleteAccountError}</span>
            </div>
          )}
        </div>
      </section>

      {/* Deliberate Account Deletion Confirmation Modal */}
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
