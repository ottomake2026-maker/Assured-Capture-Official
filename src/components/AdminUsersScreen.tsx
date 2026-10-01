import React, { useState, useEffect, useMemo } from 'react';
import { ManagedUser, UserProfile } from '../types';
import { AssuredLogo } from './AssuredLogo';
import { ConfirmationDialog } from './ConfirmationDialog';
import {
  fetchUsersList,
  createNewUser,
  updateUserStatus,
  updateUserRole,
} from '../utils/adminApi';
import { auth } from '../utils/firebaseAuth';
import {
  ArrowLeft,
  Plus,
  Shield,
  ShieldCheck,
  User,
  Users,
  Search,
  Check,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  UserCheck,
  UserX,
  Lock,
  Mail,
  X,
} from 'lucide-react';

interface AdminUsersScreenProps {
  currentUserProfile: UserProfile;
  onBack: () => void;
}

export const AdminUsersScreen: React.FC<AdminUsersScreenProps> = ({
  currentUserProfile,
  onBack,
}) => {
  const currentUid = auth.currentUser?.uid;

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'All' | 'Administrator' | 'User'>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Disabled'>('All');

  // Add User Modal state
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'Administrator' | 'User'>('User');
  const [showPassword, setShowPassword] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Toggle status confirmation
  const [pendingStatusUser, setPendingStatusUser] = useState<ManagedUser | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Load user list
  const loadUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await fetchUsersList();
      setUsers(list);
    } catch (err: any) {
      console.error('Failed to load users:', err);
      setError(err.message || 'Failed to retrieve user list from server');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // Handle Add User Submit
  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingUser) return;

    if (!newEmail.trim() || !newPassword) {
      setModalError('Please provide both an email and initial password.');
      return;
    }

    if (newPassword.length < 6) {
      setModalError('Password must be at least 6 characters.');
      return;
    }

    setIsCreatingUser(true);
    setModalError(null);

    try {
      const created = await createNewUser({
        email: newEmail.trim(),
        password: newPassword,
        displayName: newName.trim() || undefined,
        role: newRole,
      });

      setUsers((prev) => [created, ...prev.filter((u) => u.uid !== created.uid)]);
      setIsAddUserModalOpen(false);
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setNewRole('User');
      setShowPassword(false);
      setSuccessMessage(`User account for ${created.email} successfully created.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      console.error('Create user failed:', err);
      setModalError(err.message || 'Failed to create user account.');
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Handle Toggle Status (Active / Disabled)
  const handleConfirmToggleStatus = async () => {
    if (!pendingStatusUser) return;
    const target = pendingStatusUser;
    const nextDisabled = !target.disabled;

    setIsUpdatingStatus(true);
    try {
      await updateUserStatus(target.uid, nextDisabled);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === target.uid
            ? { ...u, disabled: nextDisabled, status: nextDisabled ? 'Disabled' : 'Active' }
            : u
        )
      );
      setSuccessMessage(
        `User ${target.email} has been ${nextDisabled ? 'disabled' : 'activated'}.`
      );
      setTimeout(() => setSuccessMessage(null), 3500);
      setPendingStatusUser(null);
    } catch (err: any) {
      console.error('Status update failed:', err);
      setError(err.message || 'Failed to update user status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Handle Change Role
  const handleChangeRole = async (targetUid: string, role: 'Administrator' | 'User') => {
    try {
      await updateUserRole(targetUid, role);
      setUsers((prev) =>
        prev.map((u) => (u.uid === targetUid ? { ...u, role } : u))
      );
      setSuccessMessage(`Role updated to ${role}.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error('Role update failed:', err);
      setError(err.message || 'Failed to change role.');
    }
  };

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchSearch =
        (u.email || '').toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        (u.displayName || '').toLowerCase().includes(searchTerm.toLowerCase().trim());
      const matchRole = roleFilter === 'All' || u.role === roleFilter;
      const matchStatus =
        statusFilter === 'All' ||
        (statusFilter === 'Active' && !u.disabled) ||
        (statusFilter === 'Disabled' && u.disabled);

      return matchSearch && matchRole && matchStatus;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.role === 'Administrator').length;
    const standardUsers = users.filter((u) => u.role === 'User').length;
    const active = users.filter((u) => !u.disabled).length;
    return { total, admins, standardUsers, active };
  }, [users]);

  return (
    <div id="admin_users_screen" className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[#0E1E2B]/10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            id="btn_admin_back"
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-[#F4F6F8] text-[#0E1E2B] transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center border border-[#0E1E2B]/15 bg-white"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
          <div>
            <span className="text-[10px] font-mono font-bold tracking-[0.2em] uppercase text-[#628EF7] block">
              ADMINISTRATION
            </span>
            <h1 className="text-xl sm:text-2xl font-brand font-bold tracking-tight text-[#0E1E2B]">
              User Management
            </h1>
          </div>
        </div>

        <div className="hidden sm:block">
          <AssuredLogo />
        </div>
      </div>

      {/* Global Notice Banners */}
      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-950 text-xs font-semibold flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs text-rose-700 hover:text-rose-900 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 sm:p-4 bg-white rounded-xl border border-[#0E1E2B]/15 shadow-2xs">
          <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">
            Total Users
          </div>
          <div className="text-2xl font-bold font-mono text-[#0E1E2B] mt-1">{stats.total}</div>
        </div>

        <div className="p-3.5 sm:p-4 bg-white rounded-xl border border-[#0E1E2B]/15 shadow-2xs">
          <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">
            Active Accounts
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">{stats.active}</div>
        </div>

        <div className="p-3.5 sm:p-4 bg-white rounded-xl border border-[#0E1E2B]/15 shadow-2xs">
          <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">
            Administrators
          </div>
          <div className="text-2xl font-bold font-mono text-[#628EF7] mt-1">{stats.admins}</div>
        </div>

        <div className="p-3.5 sm:p-4 bg-white rounded-xl border border-[#0E1E2B]/15 shadow-2xs">
          <div className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase tracking-wider">
            Standard Users
          </div>
          <div className="text-2xl font-bold font-mono text-[#0E1E2B] mt-1">{stats.standardUsers}</div>
        </div>
      </div>

      {/* Action Row: Add User + Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          type="button"
          id="btn_admin_add_user"
          onClick={() => {
            setModalError(null);
            setIsAddUserModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-colors touch-manipulation min-h-[48px] cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>ADD NEW USER</span>
        </button>

        <button
          type="button"
          onClick={loadUsers}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F4F6F8] text-[#0E1E2B] border border-[#0E1E2B]/20 rounded-lg text-xs font-bold transition-colors cursor-pointer min-h-[44px]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Users</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch gap-3">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#0E1E2B]/40">
            <Search className="w-4 h-4 stroke-[2]" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by email or name…"
            className="w-full pl-10 pr-12 py-2.5 bg-white border border-[#0E1E2B]/15 rounded-lg text-sm text-[#0E1E2B] placeholder:text-[#0E1E2B]/40 font-normal focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs font-semibold text-[#0E1E2B]/50 hover:text-[#0E1E2B] cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:flex gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="px-3 py-2 bg-white border border-[#0E1E2B]/15 rounded-lg text-xs font-semibold text-[#0E1E2B] focus:border-[#628EF7] outline-none min-h-[44px] cursor-pointer"
          >
            <option value="All">All Roles</option>
            <option value="Administrator">Administrators</option>
            <option value="User">Users</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 bg-white border border-[#0E1E2B]/15 rounded-lg text-xs font-semibold text-[#0E1E2B] focus:border-[#628EF7] outline-none min-h-[44px] cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Disabled">Disabled Only</option>
          </select>
        </div>
      </div>

      {/* Users List Register */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between px-0.5">
          <h2 className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-[#0E1E2B]/70">
            SYSTEM USERS ({filteredUsers.length})
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center bg-white rounded-xl border border-[#0E1E2B]/15 shadow-2xs space-y-2">
            <span className="w-5 h-5 border-2 border-[#0E1E2B]/30 border-t-[#628EF7] rounded-full animate-spin inline-block" />
            <p className="text-xs font-semibold text-[#0E1E2B]/70">Loading users from server…</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-xl border border-[#0E1E2B]/15 shadow-2xs space-y-2">
            <Users className="w-8 h-8 text-[#0E1E2B]/30 mx-auto" />
            <p className="text-sm font-bold text-[#0E1E2B]">No users found</p>
            <p className="text-xs text-[#0E1E2B]/60">
              {searchTerm || roleFilter !== 'All' || statusFilter !== 'All'
                ? 'Try adjusting your search or filters.'
                : 'Click "Add New User" to create the first account.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#0E1E2B]/15 divide-y divide-[#0E1E2B]/10 overflow-hidden shadow-2xs">
            {filteredUsers.map((u) => {
              const isSelf = u.uid === currentUid;
              const isAdmin = u.role === 'Administrator';

              return (
                <div
                  key={u.uid}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#F4F6F8]/40 transition-colors"
                >
                  {/* User Profile Info */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        isAdmin
                          ? 'bg-[#B2E5F6]/40 border-[#628EF7]/40 text-[#628EF7]'
                          : 'bg-[#F4F6F8] border-[#0E1E2B]/15 text-[#0E1E2B]/60'
                      }`}
                    >
                      {isAdmin ? (
                        <Shield className="w-5 h-5 stroke-[2]" />
                      ) : (
                        <User className="w-5 h-5 stroke-[2]" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-[#0E1E2B] truncate">
                          {u.displayName || 'User'}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] font-mono font-bold bg-[#628EF7]/10 text-[#628EF7] px-2 py-0.5 rounded border border-[#628EF7]/20">
                            YOU
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                            u.disabled
                              ? 'bg-rose-50 text-rose-900 border-rose-200'
                              : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.disabled ? 'bg-rose-600' : 'bg-emerald-600'
                            }`}
                          />
                          <span>{u.disabled ? 'Disabled' : 'Active'}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-[#0E1E2B]/65 font-medium">
                        <Mail className="w-3.5 h-3.5 text-[#0E1E2B]/40 shrink-0" />
                        <span className="truncate">{u.email}</span>
                      </div>

                      <div className="text-[11px] font-mono text-[#0E1E2B]/45">
                        UID: <span className="text-[#0E1E2B]/70">{u.uid}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Role Selector */}
                  <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                    {/* Role selector dropdown */}
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={`role_select_${u.uid}`} className="text-[11px] font-mono text-[#0E1E2B]/60 uppercase hidden md:inline">
                        Role:
                      </label>
                      <select
                        id={`role_select_${u.uid}`}
                        value={u.role}
                        disabled={isSelf}
                        onChange={(e) => handleChangeRole(u.uid, e.target.value as any)}
                        title={isSelf ? 'Cannot change your own role' : 'Change user role'}
                        className="px-2.5 py-1.5 bg-[#F4F6F8] hover:bg-[#EAEFF4] border border-[#0E1E2B]/15 rounded-lg text-xs font-bold text-[#0E1E2B] focus:border-[#628EF7] outline-none min-h-[38px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="Administrator">Administrator</option>
                        <option value="User">User</option>
                      </select>
                    </div>

                    {/* Enable / Disable Button */}
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => setPendingStatusUser(u)}
                      title={isSelf ? 'Cannot disable your own administrator account' : u.disabled ? 'Enable user access' : 'Disable user access'}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer min-h-[38px] disabled:opacity-40 disabled:cursor-not-allowed ${
                        u.disabled
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300'
                          : 'bg-white hover:bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {u.disabled ? (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Enable</span>
                        </>
                      ) : (
                        <>
                          <UserX className="w-3.5 h-3.5" />
                          <span>Disable</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ADD USER MODAL */}
      {isAddUserModalOpen && (
        <div
          id="admin_add_user_modal_backdrop"
          className="fixed inset-0 z-50 bg-[#0E1E2B]/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCreatingUser) {
              setIsAddUserModalOpen(false);
            }
          }}
        >
          <div
            id="admin_add_user_modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add_user_title"
            className="bg-white border border-[#0E1E2B]/15 rounded-2xl shadow-xl p-6 sm:p-7 max-w-[440px] w-full space-y-5 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#0E1E2B]/10">
              <div className="space-y-0.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[#628EF7]">
                  ADMINISTRATOR ACTION
                </span>
                <h2 id="add_user_title" className="text-lg font-brand font-bold text-[#0E1E2B]">
                  Add New User Account
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsAddUserModalOpen(false)}
                disabled={isCreatingUser}
                className="p-1.5 rounded-lg hover:bg-[#F4F6F8] text-[#0E1E2B]/60 hover:text-[#0E1E2B] transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-950 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUserSubmit} className="space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0E1E2B]">
                  User Email <span className="text-rose-600">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#0E1E2B]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="inspector@company.com"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-sm text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
                  />
                </div>
              </div>

              {/* Inspector Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0E1E2B]">
                  Inspector / Display Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#0E1E2B]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Alex Morgan"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-sm text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
                  />
                </div>
              </div>

              {/* Initial Password */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0E1E2B]">
                  Initial Password <span className="text-rose-600">*</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#0E1E2B]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-10 pr-11 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-sm text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-0 h-[44px] w-10 flex items-center justify-center text-[#0E1E2B]/40 hover:text-[#0E1E2B] transition-colors cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Role */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#0E1E2B]">
                  Assign Role <span className="text-rose-600">*</span>
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-sm font-semibold text-[#0E1E2B] focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 outline-none transition-all min-h-[44px] cursor-pointer"
                >
                  <option value="User">User (Standard Inspector — No Admin Access)</option>
                  <option value="Administrator">Administrator (Full User Management Access)</option>
                </select>
              </div>

              <p className="text-[11px] text-[#0E1E2B]/60 leading-relaxed pt-1">
                Account will be provisioned directly in Firebase Authentication. Passwords are encrypted and never sent to clients.
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#0E1E2B]/10">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  disabled={isCreatingUser}
                  className="px-4 py-2.5 bg-white hover:bg-[#F4F6F8] text-[#0E1E2B] text-xs font-bold rounded-lg border border-[#0E1E2B]/20 transition-colors cursor-pointer min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingUser}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors cursor-pointer min-h-[44px] disabled:opacity-50"
                >
                  {isCreatingUser ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating…</span>
                    </>
                  ) : (
                    <span>Create Account</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOGGLE STATUS CONFIRMATION DIALOG */}
      <ConfirmationDialog
        isOpen={Boolean(pendingStatusUser)}
        title={pendingStatusUser?.disabled ? 'Enable User Account' : 'Disable User Account'}
        message={
          pendingStatusUser?.disabled
            ? `Enable login access for ${pendingStatusUser?.email}? The user will immediately be able to sign in.`
            : `Disable login access for ${pendingStatusUser?.email}? The user will immediately be blocked from accessing the application.`
        }
        confirmLabel={pendingStatusUser?.disabled ? 'Enable User' : 'Disable User'}
        cancelLabel="Cancel"
        isDestructive={!pendingStatusUser?.disabled}
        isLoading={isUpdatingStatus}
        onConfirm={handleConfirmToggleStatus}
        onCancel={() => setPendingStatusUser(null)}
      />
    </div>
  );
};
