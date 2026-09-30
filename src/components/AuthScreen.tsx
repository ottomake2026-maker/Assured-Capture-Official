import React, { useState, useEffect, useCallback } from 'react';
import { AssuredLogo } from './AssuredLogo';
import {
  isEmailSignInLink,
  completeEmailSignIn,
  checkUserAuthorized,
  logout,
  EMAIL_FOR_SIGN_IN_STORAGE_KEY,
  emailSignIn,
  emailSignUp,
  getUserAuthorizationRecord,
  bootstrapInitialAdminAccount,
  INITIAL_ADMIN_EMAIL,
  sendAccessLinkToEmail,
} from '../utils/firebaseAuth';
import { User } from 'firebase/auth';
import { ActiveScreen } from '../types';
import { AlertCircle, ShieldAlert, KeyRound, Mail, CheckCircle2 } from 'lucide-react';

interface AuthScreenProps {
  onAuthenticated: (targetScreen?: ActiveScreen) => void;
  onContinueAsGuest: () => void;
}

type ScreenState = 'access_required' | 'confirm_email' | 'completing_signin' | 'admin_signin' | 'link_sent';

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  onContinueAsGuest,
}) => {
  const [screenState, setScreenState] = useState<ScreenState>('access_required');
  const [userEmail, setUserEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [adminEmail, setAdminEmail] = useState(INITIAL_ADMIN_EMAIL);
  const [adminPassword, setAdminPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuestWarning, setShowGuestWarning] = useState(false);

  // Validate email format helper
  const isValidEmail = (val: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  };

  // Process incoming Admin-Sent Email Sign-In Link
  const processIncomingLink = useCallback(async (targetEmail?: string) => {
    if (!isEmailSignInLink(window.location.href)) return;

    let emailToUse = targetEmail?.trim().toLowerCase();
    if (!emailToUse) {
      try {
        emailToUse = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_STORAGE_KEY) || undefined;
      } catch {
        emailToUse = undefined;
      }
    }

    if (!emailToUse) {
      // If opened on another device/browser without stored email, request email confirmation
      setScreenState('confirm_email');
      return;
    }

    setScreenState('completing_signin');
    setIsLoading(true);
    setError(null);

    try {
      const user = await completeEmailSignIn(emailToUse, window.location.href);

      if (!user) {
        throw new Error('Email sign-in link is invalid or expired.');
      }

      // Verify whether the authenticated user is an authorized Assured Capture account
      const authorized = await checkUserAuthorized(user);
      if (!authorized) {
        await logout();
        setError('Your account is not authorized for Assured Capture. Please contact your administrator.');
        setScreenState('access_required');
        setIsLoading(false);
        return;
      }

      onAuthenticated();
    } catch (err: any) {
      console.warn('Sign in with email link error:', err);
      const code = err?.code;
      if (
        code === 'auth/invalid-action-code' ||
        code === 'auth/expired-action-code' ||
        code === 'auth/invalid-link'
      ) {
        setError('This sign-in link is invalid or has expired. Please request a new link.');
      } else if (code === 'auth/invalid-email') {
        setError('Enter a valid email address.');
      } else if (code === 'auth/network-request-failed') {
        setError('Unable to complete sign-in. Check your connection and try again.');
      } else {
        setError('Authentication could not be completed. Please request a new link from your administrator.');
      }
      setScreenState('access_required');
      setIsLoading(false);
    }
  }, [onAuthenticated]);

  // Check for incoming email link upon page load
  useEffect(() => {
    if (isEmailSignInLink(window.location.href)) {
      processIncomingLink();
    }
  }, [processIncomingLink]);

  // Handle Sending Passwordless Email Sign-In Link to Normal User
  const handleSendAccessLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const cleanEmail = userEmail.trim().toLowerCase();
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await sendAccessLinkToEmail(cleanEmail);
      setIsLoading(false);
      setScreenState('link_sent');
    } catch (err: any) {
      console.warn('Failed to send email access link:', err);
      const code = err?.code;
      if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many requests. Please wait a moment before trying again.');
      } else {
        setError(err?.message || 'Unable to send access link. Please verify your email and try again.');
      }
      setIsLoading(false);
    }
  };

  // Handle manual confirmation of email when link is opened on a different device
  const handleConfirmEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const trimmed = confirmEmail.trim();
    if (!trimmed || !isValidEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }

    await processIncomingLink(trimmed);
  };

  // Handle Admin Sign In Form Submission
  const handleAdminSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const cleanEmail = adminEmail.trim().toLowerCase();
    const cleanPassword = adminPassword;

    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setError('Please enter a valid administrator email address.');
      return;
    }

    if (!cleanPassword) {
      setError('Please enter your administrator password.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let user: User;
      try {
        user = await emailSignIn(cleanEmail, cleanPassword);
      } catch (signInErr: any) {
        const code = signInErr?.code;
        if (
          (code === 'auth/user-not-found' || code === 'auth/invalid-credential') &&
          cleanEmail === INITIAL_ADMIN_EMAIL.toLowerCase()
        ) {
          try {
            user = await emailSignUp(cleanEmail, cleanPassword, 'System Administrator');
          } catch (signUpErr) {
            throw signInErr;
          }
        } else {
          throw signInErr;
        }
      }

      // 1. Verify user's authorization record
      const authRecord =
        (await getUserAuthorizationRecord(user)) || (await bootstrapInitialAdminAccount(user));

      // 2 & 3. Confirm role = admin and status = Active
      const isAdmin = authRecord && authRecord.role === 'admin' && authRecord.status === 'Active';

      if (isAdmin) {
        // 4. Allow access to Admin Portal
        setIsLoading(false);
        onAuthenticated('admin_users');
      } else {
        // 5. If not an active administrator, deny access, logout, return to normal app flow
        await logout();
        setError('Access Denied: Your account does not have active administrator permissions.');
        setIsLoading(false);
      }
    } catch (err: any) {
      console.warn('Admin sign-in authentication error:', err);
      const code = err?.code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Invalid password. Please check your administrator credentials.');
      } else if (code === 'auth/user-not-found') {
        setError('Administrator account not found.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many failed attempts. Please wait a moment and try again.');
      } else {
        setError(err?.message || 'Administrator authentication failed. Please try again.');
      }
      setIsLoading(false);
    }
  };

  // Loading state when completing sign-in from admin-sent link
  if (screenState === 'completing_signin') {
    return (
      <div
        id="auth_completing_signin"
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
              Signing you in…
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      id="auth_screen"
      className="min-h-screen bg-[#F4F6F8] flex flex-col justify-center items-center px-4 py-8 sm:py-12"
    >
      <div className="w-full max-w-[360px] sm:max-w-[380px] mx-auto space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="flex items-baseline justify-center gap-2 sm:gap-2.5 select-none">
            <AssuredLogo className="h-7 sm:h-8" />
            <span className="font-sans font-extrabold tracking-[0.18em] text-xs sm:text-sm text-[#628EF7] uppercase select-none">
              CAPTURE
            </span>
          </div>

          <p className="text-xs sm:text-[13px] text-[#0E1E2B]/60 font-medium leading-snug">
            Inspection documentation, kept with your account.
          </p>
        </div>

        {/* Primary Container */}
        <div className="space-y-4 pt-1">
          {/* Section Heading */}
          <div className="border-b border-[#0E1E2B]/10 pb-2">
            <h1 className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-[#0E1E2B]">
              {screenState === 'confirm_email'
                ? 'CONFIRM EMAIL'
                : screenState === 'admin_signin'
                ? 'ADMINISTRATOR SIGN IN'
                : screenState === 'link_sent'
                ? 'CHECK YOUR EMAIL'
                : 'ACCESS REQUIRED'}
            </h1>
          </div>

          {/* Error Notice */}
          {error && (
            <div
              id="auth_error_alert"
              className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-950 text-xs font-medium space-y-2.5"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </div>
            </div>
          )}

          {/* STATE 1: Confirm Email */}
          {screenState === 'confirm_email' ? (
            <form onSubmit={handleConfirmEmailSubmit} className="space-y-4">
              <p className="text-xs text-[#0E1E2B]/70 leading-relaxed">
                Please enter the authorized email address that received the access link to complete sign-in.
              </p>

              <div className="space-y-1.5">
                <label
                  htmlFor="auth_confirm_email_input"
                  className="block text-xs font-bold text-[#0E1E2B]"
                >
                  Authorized Email
                </label>
                <input
                  type="email"
                  id="auth_confirm_email_input"
                  required
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                  className="w-full px-3.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-base sm:text-sm text-[#0E1E2B] placeholder-[#0E1E2B]/35 h-[48px] sm:h-[50px] focus:outline-none focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 transition-all"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                id="auth_btn_confirm_submit"
                disabled={isLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs sm:text-sm tracking-wider uppercase rounded-lg shadow-sm transition-colors touch-manipulation h-[48px] sm:h-[50px] disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                    <span>Signing you in…</span>
                  </>
                ) : (
                  <span>Complete Sign In</span>
                )}
              </button>
            </form>
          ) : screenState === 'link_sent' ? (
            /* STATE 2: Confirmation State */
            <div className="space-y-4">
              <div
                id="auth_link_sent_card"
                className="p-5 rounded-xl bg-white border border-[#0E1E2B]/15 shadow-2xs space-y-3"
              >
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 shrink-0 mt-0.5 border border-emerald-200">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-sm font-bold text-[#0E1E2B]">
                      Check your email
                    </h2>
                    <p className="text-xs text-[#0E1E2B]/80 leading-relaxed">
                      We’ve sent a secure access link to <strong className="text-[#0E1E2B] font-semibold">{userEmail}</strong>. Open the link on this device to continue.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  id="auth_btn_use_different_email"
                  onClick={() => {
                    setError(null);
                    setScreenState('access_required');
                  }}
                  className="text-xs font-semibold text-[#0E1E2B]/60 hover:text-[#0E1E2B] transition-colors py-1.5 px-3 cursor-pointer rounded-lg hover:bg-[#0E1E2B]/5 inline-block"
                >
                  ← Use a different email address
                </button>
              </div>
            </div>
          ) : screenState === 'admin_signin' ? (
            /* STATE 3: Admin Sign In Screen */
            <form onSubmit={handleAdminSignInSubmit} className="space-y-4">
              <div className="p-4 rounded-xl bg-white border border-[#0E1E2B]/15 shadow-2xs space-y-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#0E1E2B] text-[#B2E5F6] shrink-0">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-xs font-bold text-[#0E1E2B]">
                      Administrator Portal Access
                    </h2>
                    <p className="text-[11px] text-[#0E1E2B]/70 leading-relaxed">
                      Enter your administrator credentials to manage users and view authorized accounts.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="admin_email_input"
                  className="block text-xs font-bold text-[#0E1E2B]"
                >
                  Administrator Email
                </label>
                <input
                  type="email"
                  id="admin_email_input"
                  required
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="ottomake2026@gmail.com"
                  autoComplete="email"
                  className="w-full px-3.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-base sm:text-sm text-[#0E1E2B] placeholder-[#0E1E2B]/35 h-[48px] sm:h-[50px] focus:outline-none focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 transition-all"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="admin_password_input"
                  className="block text-xs font-bold text-[#0E1E2B]"
                >
                  Password
                </label>
                <input
                  type="password"
                  id="admin_password_input"
                  required
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full px-3.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-base sm:text-sm text-[#0E1E2B] placeholder-[#0E1E2B]/35 h-[48px] sm:h-[50px] focus:outline-none focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 transition-all"
                />
              </div>

              <button
                type="submit"
                id="admin_btn_signin_submit"
                disabled={isLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 bg-[#0E1E2B] hover:bg-[#1A2E3D] active:bg-[#07131D] text-white font-sans font-bold text-xs sm:text-sm tracking-wider uppercase rounded-lg shadow-sm transition-colors touch-manipulation h-[48px] sm:h-[50px] disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                    <span>Verifying Admin Permissions…</span>
                  </>
                ) : (
                  <span>Sign In as Administrator</span>
                )}
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  id="admin_btn_back_to_access"
                  disabled={isLoading}
                  onClick={() => {
                    setError(null);
                    setScreenState('access_required');
                  }}
                  className="text-xs font-semibold text-[#0E1E2B]/60 hover:text-[#0E1E2B] transition-colors py-1.5 px-3 cursor-pointer rounded-lg hover:bg-[#0E1E2B]/5 inline-block disabled:opacity-40"
                >
                  ← Back to sign in
                </button>
              </div>
            </form>
          ) : (
            /* STATE 4: Minimal "Access Required" State with Email Access Link Input */
            <div className="space-y-4">
              <form onSubmit={handleSendAccessLink} className="p-5 rounded-xl bg-white border border-[#0E1E2B]/15 shadow-2xs space-y-4">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-lg bg-[#628EF7]/10 text-[#628EF7] shrink-0 mt-0.5">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-sm font-bold text-[#0E1E2B]">
                      Access Required
                    </h2>
                    <p className="text-xs text-[#0E1E2B]/80 leading-relaxed">
                      Enter your email to receive a passwordless sign-in link.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <label
                    htmlFor="user_access_email_input"
                    className="block text-xs font-bold text-[#0E1E2B]"
                  >
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="user_access_email_input"
                    required
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="name@company.com"
                    autoComplete="email"
                    className="w-full px-3.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-base sm:text-sm text-[#0E1E2B] placeholder-[#0E1E2B]/35 h-[48px] sm:h-[50px] focus:outline-none focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 transition-all"
                  />
                </div>

                <button
                  type="submit"
                  id="auth_btn_send_access_link"
                  disabled={isLoading}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs sm:text-sm tracking-wider uppercase rounded-lg shadow-sm transition-colors touch-manipulation h-[48px] sm:h-[50px] disabled:opacity-50 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                      <span>Sending Link…</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 shrink-0" />
                      <span>SEND ACCESS LINK</span>
                    </>
                  )}
                </button>
              </form>

              {/* Secondary Options: Continue without account & Administrator? Sign in */}
              <div className="pt-2 text-center space-y-1">
                <div>
                  <button
                    type="button"
                    id="auth_btn_continue_without_account"
                    disabled={isLoading}
                    onClick={() => setShowGuestWarning(true)}
                    className="text-xs font-semibold text-[#0E1E2B]/75 hover:text-[#0E1E2B] transition-colors py-1.5 px-3 cursor-pointer rounded-lg hover:bg-[#0E1E2B]/5 active:bg-[#0E1E2B]/10 inline-block disabled:opacity-40"
                  >
                    Continue without an account
                  </button>
                </div>
                <div>
                  <button
                    type="button"
                    id="auth_btn_admin_signin"
                    disabled={isLoading}
                    onClick={() => {
                      setError(null);
                      setScreenState('admin_signin');
                    }}
                    className="text-xs font-medium text-[#0E1E2B]/50 hover:text-[#628EF7] transition-colors py-1 px-3 cursor-pointer rounded hover:bg-[#0E1E2B]/5 inline-block disabled:opacity-40"
                  >
                    Administrator? Sign in
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quiet Reassurance near bottom */}
        <div className="pt-4 border-t border-[#0E1E2B]/10 text-center">
          <p className="text-[11px] font-mono uppercase tracking-wider text-[#0E1E2B]/50 leading-normal">
            Your reports are securely associated with your account.
          </p>
        </div>
      </div>

      {/* Warning Modal Before Entering Guest Mode */}
      {showGuestWarning && (
        <div
          id="guest_warning_modal_backdrop"
          className="fixed inset-0 z-50 bg-[#0E1E2B]/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowGuestWarning(false);
            }
          }}
        >
          <div
            id="guest_warning_modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest_warning_title"
            className="bg-white border border-[#0E1E2B]/15 rounded-xl shadow-lg p-6 sm:p-7 max-w-[420px] w-full space-y-5 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono font-bold uppercase tracking-[0.18em] text-[#0E1E2B]/60">
                CONTINUE WITHOUT ACCOUNT
              </div>
              <h2
                id="guest_warning_title"
                className="text-lg sm:text-xl font-brand font-bold text-[#0E1E2B] tracking-tight leading-tight"
              >
                Your reports may not be recoverable
              </h2>
            </div>

            <div className="space-y-3 text-xs sm:text-[13px] text-[#0E1E2B]/80 leading-relaxed">
              <p>
                Without an account, your reports may be stored only on this device. If you clear app data, change devices, or lose local data, you may lose access to reports saved without an account.
              </p>
              <p>
                Use your administrator-provided access link to associate your reports with your account.
              </p>
            </div>

            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                id="modal_btn_continue_without_account"
                onClick={() => {
                  setShowGuestWarning(false);
                  onContinueAsGuest();
                }}
                className="w-full inline-flex items-center justify-center px-5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs sm:text-sm tracking-wider uppercase rounded-lg shadow-sm transition-colors touch-manipulation h-[48px] sm:h-[50px] cursor-pointer"
              >
                Continue without account
              </button>

              <button
                type="button"
                id="modal_btn_stay_on_signin"
                onClick={() => setShowGuestWarning(false)}
                className="w-full inline-flex items-center justify-center px-5 bg-white hover:bg-[#F4F6F8] active:bg-[#EAEFF4] text-[#0E1E2B] font-medium text-xs sm:text-sm rounded-lg border border-[#0E1E2B]/20 transition-colors touch-manipulation h-[48px] sm:h-[50px] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
