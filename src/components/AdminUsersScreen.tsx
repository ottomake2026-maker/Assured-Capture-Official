import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ManagedUser, UserProfile } from '../types';
import { fetchUsersList, createNewUser, updateUserStatus } from '../utils/adminApi';
import { ConfirmationDialog } from './ConfirmationDialog';
import { AssuredSelect } from './AssuredSelect';
import {
  ArrowLeft,
  Plus,
  ShieldCheck,
  User as UserIcon,
  Search,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  X,
  MoreHorizontal,
  Users,
  Loader2,
  RefreshCw,
  UserCheck,
  UserX,
} from 'lucide-react';

interface AdminUsersScreenProps {
  currentUserProfile?: UserProfile;
  onBack: () => void;
}

export const AdminUsersScreen: React.FC<AdminUsersScreenProps> = ({
  onBack,
}) => {
  // Real Firebase Authentication users state
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Disabled'>('All');
  const [roleFilter, setRoleFilter] = useState<'All' | 'Administrator' | 'User'>('All');

  // Active overflow dropdown menu
  const [activeMenuUid, setActiveMenuUid] = useState<string | null>(null);

  // Add User Modal State (Stage 2)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Enable/Disable User State (Stage 3)
  const [pendingStatusUser, setPendingStatusUser] = useState<ManagedUser | null>(null);
  const [isStatusUpdating, setIsStatusUpdating] = useState(false);

  // Success toast state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  // Close overflow menu when clicking outside
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.user-actions-menu-container')) {
        setActiveMenuUid(null);
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  // Load real Firebase Authentication users from secure server endpoint
  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const realUsers = await fetchUsersList();
      setUsers(realUsers);
    } catch (err: any) {
      console.error('Error fetching admin users:', err);
      setErrorMessage('Unable to load users. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch once on mount when screen opens
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Handle Add User submission (Stage 2)
  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) {
      setModalError('Full Name is required.');
      return;
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setModalError('A valid email address is required.');
      return;
    }

    if (!password || password.length < 6) {
      setModalError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setModalError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const createdUser = await createNewUser({
        fullName: cleanName,
        email: cleanEmail,
        password,
      });

      // Clear password fields immediately
      setPassword('');
      setConfirmPassword('');
      setFullName('');
      setEmail('');
      setIsAddModalOpen(false);

      showToast('User created successfully.');

      // Prepend newly created user
      setUsers((prev) => {
        const exists = prev.some((u) => u.uid === createdUser.uid || u.email === createdUser.email);
        if (exists) return prev;
        return [createdUser, ...prev];
      });

      // Synchronize list with backend
      try {
        const refreshed = await fetchUsersList();
        setUsers(refreshed);
      } catch {
        // Retain optimistic state if refresh fails
      }
    } catch (err: any) {
      console.error('Create user submission error:', err);
      setModalError(err?.message || 'Unable to create user. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Confirm Status Toggle (Stage 3: Enable / Disable)
  const handleConfirmToggleStatus = async () => {
    if (!pendingStatusUser || isStatusUpdating) return;

    const targetUser = pendingStatusUser;
    const nextDisabled = !targetUser.disabled;
    const nextStatus = nextDisabled ? ('Disabled' as const) : ('Active' as const);

    setIsStatusUpdating(true);
    try {
      await updateUserStatus(targetUser.uid, nextDisabled);

      // Update state immediately without reloading whole application
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === targetUser.uid
            ? {
                ...u,
                disabled: nextDisabled,
                status: nextStatus,
              }
            : u
        )
      );

      setPendingStatusUser(null);
      showToast(
        nextDisabled
          ? `User ${targetUser.displayName || targetUser.email} has been disabled.`
          : `User ${targetUser.displayName || targetUser.email} has been enabled.`
      );
    } catch (err: any) {
      console.error('Update status error:', err);
      showToast(err?.message || 'Failed to update user status.');
    } finally {
      setIsStatusUpdating(false);
    }
  };

  // Filtered users list based on real search & filter inputs
  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return users.filter((u) => {
      const name = (u.displayName || '').toLowerCase();
      const em = (u.email || '').toLowerCase();
      const matchSearch = !term || name.includes(term) || em.includes(term);

      const matchStatus =
        statusFilter === 'All' ||
        (statusFilter === 'Active' && !u.disabled) ||
        (statusFilter === 'Disabled' && u.disabled);

      const matchRole = roleFilter === 'All' || u.role === roleFilter;

      return matchSearch && matchStatus && matchRole;
    });
  }, [users, searchTerm, statusFilter, roleFilter]);

  // Format date helper: Sep 28, 2026
  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  // Extract initials for circular avatar: "John Doe" -> "JD"
  const getInitials = (name?: string, userEmail?: string) => {
    if (name && name.trim()) {
      const parts = name.trim().split(' ').filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    if (userEmail && userEmail.trim()) {
      return userEmail.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  return (
    <div className="w-full max-w-5xl lg:max-w-6xl mx-auto px-4 py-4 sm:px-6 sm:py-6 space-y-5">
      {/* 1. TOP BREADCRUMB & AREA BADGE */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#0E1E2B]/10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#0E1E2B]/15 bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] text-[#0E1E2B] font-mono font-bold text-xs uppercase tracking-wider touch-manipulation min-h-[40px] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30"
          aria-label="Back to profile settings"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
          <span>Profile Settings</span>
        </button>

        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#0E1E2B]/60 bg-[#B2E5F6]/40 border border-[#0E1E2B]/15 px-2.5 py-1 rounded">
          Admin Area
        </span>
      </div>

      {/* 2. TITLE BAR & PRIMARY ACTION (+ Add User in Stage 2) */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-brand font-bold text-[#0E1E2B] tracking-tight">
              Admin Users
            </h1>
            {!isLoading && !errorMessage && (
              <span className="text-xs font-mono font-bold text-[#0E1E2B] bg-white border border-[#0E1E2B]/15 px-2.5 py-0.5 rounded-full shadow-2xs">
                {users.length} {users.length === 1 ? 'user' : 'users'}
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-[#0E1E2B]/65 font-normal">
            Manage access to Assured Capture.
          </p>
        </div>

        {/* Primary Action Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setFullName('');
              setEmail('');
              setPassword('');
              setConfirmPassword('');
              setShowPassword(false);
              setIsAddModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs uppercase tracking-wider rounded-lg transition-colors touch-manipulation min-h-[44px] shadow-sm cursor-pointer active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-[#628EF7]/25 shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.4]" />
            <span>Add User</span>
          </button>
        </div>
      </header>

      {/* Success Notification Toast */}
      {successMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-950 flex items-center gap-2.5 shadow-2xs animate-in fade-in duration-150">
          <Check className="w-4 h-4 text-emerald-600 shrink-0 stroke-[2.5]" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* 3. COMPACT USER MANAGEMENT TOOLBAR */}
      <div className="bg-white border border-[#0E1E2B]/15 rounded-xl p-2.5 sm:p-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Search Field */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#0E1E2B]/40">
              <Search className="w-4 h-4 stroke-[2]" />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search users by name or email..."
              className="w-full pl-9 pr-12 py-2 bg-[#F8FAFC] border border-[#0E1E2B]/15 rounded-lg text-xs sm:text-sm text-[#0E1E2B] placeholder:text-[#0E1E2B]/40 focus:bg-white focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[40px]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs font-semibold text-[#0E1E2B]/50 hover:text-[#0E1E2B] cursor-pointer min-h-[40px] px-1"
              >
                Clear
              </button>
            )}
          </div>

          {/* Unified Compact Filters */}
          <div className="flex items-center gap-2 shrink-0 sm:w-auto w-full">
            {/* Status Dropdown */}
            <div className="w-36">
              <AssuredSelect
                id="admin_status_filter"
                value={statusFilter}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value as any)}
                aria-label="Filter by status"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Disabled">Disabled</option>
              </AssuredSelect>
            </div>

            {/* Role Dropdown */}
            <div className="w-36">
              <AssuredSelect
                id="admin_role_filter"
                value={roleFilter}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRoleFilter(e.target.value as any)}
                aria-label="Filter by role"
              >
                <option value="All">All Roles</option>
                <option value="Administrator">Administrator</option>
                <option value="User">User</option>
              </AssuredSelect>
            </div>
          </div>
        </div>
      </div>

      {/* 4. LIGHT ENTERPRISE DATA TABLE / STATES */}
      <section aria-label="Admin users table" className="space-y-2">
        <div className="bg-white rounded-xl border border-[#0E1E2B]/15 shadow-2xs overflow-hidden">
          {isLoading ? (
            /* Loading State */
            <div className="p-12 sm:p-16 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-[#B2E5F6]/40 text-[#0E1E2B] flex items-center justify-center mx-auto mb-1 animate-spin">
                <Loader2 className="w-5 h-5" />
              </div>
              <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/75">
                Loading users…
              </p>
            </div>
          ) : errorMessage ? (
            /* Professional Error State */
            <div className="p-10 sm:p-14 text-center space-y-3.5">
              <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto mb-1">
                <AlertCircle className="w-6 h-6 stroke-[2]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-[#0E1E2B]">Unable to load users.</h3>
                <p className="text-xs text-[#0E1E2B]/65 max-w-sm mx-auto font-normal">
                  Please try again.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={loadUsers}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer min-h-[40px] shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              </div>
            </div>
          ) : users.length === 0 ? (
            /* Clean Empty State when Zero Firebase Users Exist */
            <div className="p-10 sm:p-14 text-center space-y-3.5">
              <div className="w-12 h-12 rounded-xl bg-[#F4F6F8] border border-[#0E1E2B]/15 text-[#0E1E2B]/40 flex items-center justify-center mx-auto mb-1">
                <Users className="w-6 h-6 stroke-[1.8]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-[#0E1E2B]">No users yet</h3>
                <p className="text-xs text-[#0E1E2B]/65 max-w-sm mx-auto font-normal">
                  Create a user to give someone access to Assured Capture.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setFullName('');
                    setEmail('');
                    setPassword('');
                    setConfirmPassword('');
                    setShowPassword(false);
                    setIsAddModalOpen(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer min-h-[44px] shadow-sm active:scale-[0.99]"
                >
                  <Plus className="w-4 h-4 stroke-[2.4]" />
                  <span>Add User</span>
                </button>
              </div>
            </div>
          ) : filteredUsers.length === 0 ? (
            /* Clean Filter/Search Empty State */
            <div className="p-8 sm:p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#F4F6F8] border border-[#0E1E2B]/15 text-[#0E1E2B]/40 flex items-center justify-center mx-auto mb-1">
                <Users className="w-6 h-6 stroke-[1.8]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-[#0E1E2B]">No users found</h3>
                <p className="text-xs text-[#0E1E2B]/65 max-w-sm mx-auto font-normal">
                  Try adjusting your search or filters to find users.
                </p>
              </div>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('All');
                    setRoleFilter('All');
                  }}
                  className="inline-flex items-center px-4 py-2 bg-[#F4F6F8] hover:bg-[#E5E8EB] text-[#0E1E2B] text-xs font-bold uppercase tracking-wider rounded-lg border border-[#0E1E2B]/15 transition-colors cursor-pointer min-h-[40px]"
                >
                  Reset Filters
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[620px]">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#0E1E2B]/12 text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/70 select-none">
                    <th className="py-3 px-4 sm:px-5 font-bold">USER</th>
                    <th className="py-3 px-4 font-bold">EMAIL</th>
                    <th className="py-3 px-3 font-bold">ROLE</th>
                    <th className="py-3 px-3 font-bold">STATUS</th>
                    <th className="py-3 px-4 font-bold">CREATED</th>
                    <th className="py-3 px-4 sm:px-5 text-right font-bold">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0E1E2B]/8 text-xs">
                  {filteredUsers.map((user) => {
                    const isAdmin = user.role === 'Administrator';
                    const isDisabled = user.disabled;
                    const displayName = user.displayName || user.email || 'User';
                    const initials = getInitials(displayName, user.email);
                    const isMenuOpen = activeMenuUid === user.uid;

                    return (
                      <tr
                        key={user.uid}
                        className="hover:bg-[#F8FAFC] transition-colors group"
                      >
                        {/* 1. USER: Avatar Initials + Full Name (Visually Strongest) */}
                        <td className="py-3.5 px-4 sm:px-5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#B2E5F6]/40 border border-[#0E1E2B]/15 text-[#0E1E2B] font-mono font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                              {initials}
                            </div>
                            <span className="font-bold text-[#0E1E2B] text-sm tracking-tight truncate max-w-[180px] sm:max-w-[240px]">
                              {displayName}
                            </span>
                          </div>
                        </td>

                        {/* 2. EMAIL (Clean muted text) */}
                        <td className="py-3.5 px-4 font-mono text-[#0E1E2B]/75 text-xs">
                          {user.email || '—'}
                        </td>

                        {/* 3. ROLE (Subtle Badge) */}
                        <td className="py-3.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold uppercase tracking-wide border ${
                              isAdmin
                                ? 'bg-[#F0FDFA] text-[#0F766E] border-[#CCFBF1]'
                                : 'bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]'
                            }`}
                          >
                            {isAdmin ? (
                              <ShieldCheck className="w-3 h-3 stroke-[2.2]" />
                            ) : (
                              <UserIcon className="w-3 h-3 stroke-[2.2]" />
                            )}
                            <span>{isAdmin ? 'Administrator' : 'User'}</span>
                          </span>
                        </td>

                        {/* 4. STATUS (Subtle Pill) */}
                        <td className="py-3.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${
                              isDisabled
                                ? 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]'
                                : 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isDisabled ? 'bg-[#94A3B8]' : 'bg-[#10B981]'
                              }`}
                            />
                            <span>{isDisabled ? 'Disabled' : 'Active'}</span>
                          </span>
                        </td>

                        {/* 5. CREATED (Muted Date: Sep 28, 2026) */}
                        <td className="py-3.5 px-4 font-mono text-[#0E1E2B]/60 text-xs whitespace-nowrap">
                          {formatDate(user.createdAt)}
                        </td>

                        {/* 6. ACTIONS: Stage 3 Enable / Disable Action in Overflow Menu */}
                        <td className="py-3.5 px-4 sm:px-5 text-right relative user-actions-menu-container">
                          {isAdmin ? (
                            <div className="inline-flex items-center justify-end opacity-40 cursor-not-allowed">
                              <span
                                className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/50 px-2.5 py-1"
                                title="The Administrator account cannot be disabled"
                              >
                                Protected
                              </span>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end">
                              {/* Overflow Menu Trigger [ ⋯ ] */}
                              <div className="relative inline-block text-left">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuUid(isMenuOpen ? null : user.uid);
                                  }}
                                  className={`p-1.5 rounded-lg border transition-colors cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center touch-manipulation ${
                                    isMenuOpen
                                      ? 'bg-[#0E1E2B] text-white border-[#0E1E2B]'
                                      : 'bg-white hover:bg-[#F8FAFC] active:bg-[#F1F5F9] text-[#0E1E2B]/70 hover:text-[#0E1E2B] border-[#0E1E2B]/20'
                                  }`}
                                  aria-expanded={isMenuOpen}
                                  aria-label={`Actions for ${displayName}`}
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>

                                {isMenuOpen && (
                                  <div
                                    className="absolute right-0 mt-1 w-44 bg-white rounded-xl border border-[#0E1E2B]/15 shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuUid(null);
                                        setPendingStatusUser(user);
                                      }}
                                      className={`w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer min-h-[38px] ${
                                        isDisabled
                                          ? 'text-emerald-700 hover:bg-emerald-50'
                                          : 'text-rose-700 hover:bg-rose-50'
                                      }`}
                                    >
                                      {isDisabled ? (
                                        <UserCheck className="w-3.5 h-3.5 shrink-0" />
                                      ) : (
                                        <UserX className="w-3.5 h-3.5 shrink-0" />
                                      )}
                                      <span>
                                        {isDisabled ? 'Enable User' : 'Disable User'}
                                      </span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* 5. COMPACT ADD USER MODAL (STAGE 2) */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0E1E2B]/40 backdrop-blur-[1px] animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-user-modal-title"
        >
          <div className="w-full max-w-md bg-white rounded-xl border border-[#0E1E2B]/15 shadow-xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 pb-3 border-b border-[#0E1E2B]/10 flex items-center justify-between">
              <div>
                <h3
                  id="add-user-modal-title"
                  className="text-base font-brand font-bold text-[#0E1E2B]"
                >
                  Add User
                </h3>
                <p className="text-xs text-[#0E1E2B]/60 mt-0.5">
                  Create a new Firebase user with initial credentials.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !isSubmitting && setIsAddModalOpen(false)}
                disabled={isSubmitting}
                className="p-1.5 -mr-1 text-[#0E1E2B]/50 hover:text-[#0E1E2B] rounded-lg transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddUserSubmit} className="p-4 sm:p-5 space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                  Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  disabled={isSubmitting}
                  className="w-full text-sm font-medium px-3.5 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                  Email <span className="text-rose-600">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  disabled={isSubmitting}
                  className="w-full text-sm font-medium px-3.5 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                  Password <span className="text-rose-600">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    disabled={isSubmitting}
                    className="w-full text-sm font-mono px-3.5 py-2.5 pr-10 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#0E1E2B]/50 hover:text-[#0E1E2B] cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-[11px] font-mono font-bold uppercase tracking-wider text-[#0E1E2B]/80 mb-1.5">
                  Confirm Password <span className="text-rose-600">*</span>
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  disabled={isSubmitting}
                  className="w-full text-sm font-mono px-3.5 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
                />
              </div>

              {modalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-3 border-t border-[#0E1E2B]/10 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2.5 rounded-lg bg-white border border-[#0E1E2B]/20 hover:bg-[#F4F6F8] text-[#0E1E2B] font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-colors cursor-pointer min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating…</span>
                    </>
                  ) : (
                    <span>Create User</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. COMPACT STATUS CONFIRMATION DIALOG (STAGE 3: ENABLE / DISABLE) */}
      <ConfirmationDialog
        isOpen={Boolean(pendingStatusUser)}
        title={pendingStatusUser?.disabled ? 'Enable User?' : 'Disable User?'}
        message={
          pendingStatusUser?.disabled
            ? 'This user will be able to sign in to Assured Capture again.'
            : 'This user will no longer be able to sign in to Assured Capture.'
        }
        confirmLabel={
          pendingStatusUser?.disabled
            ? isStatusUpdating
              ? 'Enabling…'
              : 'Enable User'
            : isStatusUpdating
            ? 'Disabling…'
            : 'Disable User'
        }
        cancelLabel="Cancel"
        isDestructive={!pendingStatusUser?.disabled}
        isLoading={isStatusUpdating}
        onConfirm={handleConfirmToggleStatus}
        onCancel={() => !isStatusUpdating && setPendingStatusUser(null)}
      />
    </div>
  );
};
