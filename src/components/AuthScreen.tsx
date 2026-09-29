import React, { useState } from 'react';
import { AssuredLogo } from './AssuredLogo';
import { emailSignIn, emailSignUp, sendPasswordReset } from '../utils/firebaseAuth';
import { Eye, EyeOff, AlertCircle, RefreshCw, Check } from 'lucide-react';

interface AuthScreenProps {
  onAuthenticated: () => void;
  onContinueAsGuest: () => void;
}

type AuthMode = 'signin' | 'signup' | 'forgot_password';

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated, onContinueAsGuest }) => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [showGuestWarning, setShowGuestWarning] = useState(false);
  const [isSecuringWorkspace, setIsSecuringWorkspace] = useState(false);

  // Handle Password Reset Request
  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    if (!email.trim()) {
      setError('Please enter your email address to receive a password reset link.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessNotice(null);

    try {
      await sendPasswordReset(email.trim());
      setSuccessNotice(`Password reset instructions sent to ${email.trim()}. Please check your inbox.`);
    } catch (err: any) {
      const code = err?.code;
      if (code === 'auth/operation-not-allowed') {
        console.info('Password reset is not enabled because email auth provider is disabled.');
        setError('Password reset is unavailable because email sign-in is not enabled for this project.');
      } else if (code === 'auth/user-not-found') {
        setError('No account found with this email address.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        console.error('Password reset error:', err);
        setError(err?.message || 'Could not send password reset email. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Email & Password Submission (Sign In or Sign Up)
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessNotice(null);

    try {
      if (mode === 'signup') {
        await emailSignUp(email.trim(), password, displayName.trim() || undefined);
      } else {
        await emailSignIn(email.trim(), password);
      }
      setIsSecuringWorkspace(true);
      onAuthenticated();
    } catch (err: any) {
      setIsSecuringWorkspace(false);
      const code = err?.code;
      if (code === 'auth/operation-not-allowed') {
        console.info('Email authentication provider is not enabled on this Firebase project.');
        setError('Email & password authentication is disabled for this project.');
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setError('Invalid email or password. Please verify your credentials.');
      } else if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Please sign in instead.');
      } else if (code === 'auth/weak-password') {
        setError('Password is too weak. Please use at least 6 characters.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        console.error('Email auth error:', err);
        setError(err?.message || 'Authentication could not be completed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Clean branded loading state when securing workspace
  if (isSecuringWorkspace) {
    return (
      <div
        id="auth_securing_workspace"
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

  return (
    <div
      id="auth_screen"
      className="min-h-screen bg-[#F4F6F8] flex flex-col justify-center items-center px-4 py-8 sm:py-12"
    >
      <div className="w-full max-w-[360px] sm:max-w-[380px] mx-auto space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          {/* Transparent wordmark asset directly on the page, with approved CAPTURE lockup */}
          <div className="flex items-baseline justify-center gap-2 sm:gap-2.5 select-none">
            <AssuredLogo className="h-7 sm:h-8" />
            <span className="font-sans font-extrabold tracking-[0.18em] text-xs sm:text-sm text-[#628EF7] uppercase select-none">
              CAPTURE
            </span>
          </div>

          {/* Understated documentary supporting copy */}
          <p className="text-xs sm:text-[13px] text-[#0E1E2B]/60 font-medium leading-snug">
            Inspection documentation, kept with your account.
          </p>
        </div>

        {/* Primary Form Section */}
        <div className="space-y-4 pt-1">
          {/* Heading */}
          <div className="border-b border-[#0E1E2B]/10 pb-2">
            <h1 className="text-xs font-mono font-bold uppercase tracking-[0.18em] text-[#0E1E2B]">
              {mode === 'signin' && 'SIGN IN'}
              {mode === 'signup' && 'CREATE ACCOUNT'}
              {mode === 'forgot_password' && 'RESET PASSWORD'}
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

          {/* Success Notice */}
          {successNotice && (
            <div
              id="auth_success_alert"
              className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs font-medium flex items-start gap-2.5"
            >
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span className="leading-snug">{successNotice}</span>
            </div>
          )}

          {/* Password Recovery Form */}
          {mode === 'forgot_password' ? (
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <p className="text-xs text-[#0E1E2B]/70 leading-relaxed">
                Enter your account email to receive a password reset link.
              </p>

              <div className="space-y-1.5">
                <label
                  htmlFor="auth_input_email"
                  className="block text-xs font-bold text-[#0E1E2B]"
                >
                  Email
                </label>
                <input
                  type="email"
                  id="auth_input_email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                  className="w-full px-3.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-base sm:text-sm text-[#0E1E2B] placeholder-[#0E1E2B]/35 h-[48px] sm:h-[50px] focus:outline-none focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 transition-all"
                />
              </div>

              <button
                type="submit"
                id="auth_btn_reset_submit"
                disabled={isLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs sm:text-sm tracking-wider uppercase rounded-lg shadow-sm transition-colors touch-manipulation h-[48px] sm:h-[50px] disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <span>Send Reset Link</span>
                )}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  id="auth_link_back_to_signin"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                    setSuccessNotice(null);
                  }}
                  className="text-xs text-[#0E1E2B]/70 hover:text-[#0E1E2B] font-medium transition-colors cursor-pointer py-1"
                >
                  Back to Sign In
                </button>
              </div>
            </form>
          ) : (
            /* Sign In or Sign Up Form */
            <form onSubmit={handleEmailAuth} className="space-y-4">
              {/* Optional Name field for account registration */}
              {mode === 'signup' && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth_input_name"
                    className="block text-xs font-bold text-[#0E1E2B]"
                  >
                    Inspector Name
                  </label>
                  <input
                    type="text"
                    id="auth_input_name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Full name"
                    autoComplete="name"
                    className="w-full px-3.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-base sm:text-sm text-[#0E1E2B] placeholder-[#0E1E2B]/35 h-[48px] sm:h-[50px] focus:outline-none focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 transition-all"
                  />
                </div>
              )}

              {/* Email field */}
              <div className="space-y-1.5">
                <label
                  htmlFor="auth_input_email"
                  className="block text-xs font-bold text-[#0E1E2B]"
                >
                  Email
                </label>
                <input
                  type="email"
                  id="auth_input_email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                  className="w-full px-3.5 bg-white border border-[#0E1E2B]/20 rounded-lg text-base sm:text-sm text-[#0E1E2B] placeholder-[#0E1E2B]/35 h-[48px] sm:h-[50px] focus:outline-none focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 transition-all"
                />
              </div>

              {/* Password field */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="auth_input_password"
                    className="block text-xs font-bold text-[#0E1E2B]"
                  >
                    Password
                  </label>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="auth_input_password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    className="w-full pl-3.5 pr-11 bg-white border border-[#0E1E2B]/20 rounded-lg text-base sm:text-sm text-[#0E1E2B] placeholder-[#0E1E2B]/35 h-[48px] sm:h-[50px] focus:outline-none focus:border-[#628EF7] focus:ring-2 focus:ring-[#628EF7]/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-0 h-[48px] sm:h-[50px] w-11 flex items-center justify-center text-[#0E1E2B]/40 hover:text-[#0E1E2B] transition-colors cursor-pointer"
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

              {/* Primary Action: Sign In or Create Account */}
              <button
                type="submit"
                id="auth_btn_submit"
                disabled={isLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs sm:text-sm tracking-wider uppercase rounded-lg shadow-sm transition-colors touch-manipulation h-[48px] sm:h-[50px] disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                    <span>{mode === 'signin' ? 'Signing in…' : mode === 'signup' ? 'Creating account…' : 'Processing…'}</span>
                  </>
                ) : (
                  <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
                )}
              </button>

              {/* Forgot password link below the primary sign-in action in signin mode */}
              {mode === 'signin' && (
                <div className="text-center pt-0.5">
                  <button
                    type="button"
                    id="auth_link_forgot_password"
                    onClick={() => {
                      setMode('forgot_password');
                      setError(null);
                      setSuccessNotice(null);
                    }}
                    className="text-xs text-[#0E1E2B]/60 hover:text-[#0E1E2B] font-medium transition-colors cursor-pointer py-1"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {/* Contextual Switch: Sign In <-> Create Account */}
              <div className="pt-2 text-center text-xs text-[#0E1E2B]/70">
                {mode === 'signin' ? (
                  <span>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      id="auth_link_toggle_signup"
                      onClick={() => {
                        setMode('signup');
                        setError(null);
                        setSuccessNotice(null);
                      }}
                      className="font-bold text-[#628EF7] hover:underline cursor-pointer py-1"
                    >
                      Create account
                    </button>
                  </span>
                ) : (
                  <span>
                    Already have an account?{' '}
                    <button
                      type="button"
                      id="auth_link_toggle_signin"
                      onClick={() => {
                        setMode('signin');
                        setError(null);
                        setSuccessNotice(null);
                      }}
                      className="font-bold text-[#628EF7] hover:underline cursor-pointer py-1"
                    >
                      Sign in
                    </button>
                  </span>
                )}
              </div>

              {/* Secondary Action: Continue without an account */}
              <div className="pt-1.5 text-center">
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
            </form>
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
                Create an account to associate your reports with your account and access them again after signing in.
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
                Stay on sign in
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
