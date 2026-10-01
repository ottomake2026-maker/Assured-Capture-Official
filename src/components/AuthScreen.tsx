import React, { useState } from 'react';
import { AssuredLogo } from './AssuredLogo';
import { emailSignIn } from '../utils/firebaseAuth';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

interface AuthScreenProps {
  onAuthenticated: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSecuringWorkspace, setIsSecuringWorkspace] = useState(false);

  // Handle Email & Password Submission (Sign In)
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

    try {
      await emailSignIn(email.trim(), password);
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
              SIGN IN
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

          {/* Sign In Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
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
                  autoComplete="current-password"
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

            {/* Primary Action: Sign In */}
            <button
              type="submit"
              id="auth_btn_submit"
              disabled={isLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-5 bg-[#628EF7] hover:bg-[#4E7AF2] active:bg-[#3E69E0] text-white font-sans font-bold text-xs sm:text-sm tracking-wider uppercase rounded-lg shadow-sm transition-colors touch-manipulation h-[48px] sm:h-[50px] disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                  <span>Signing in…</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>
        </div>

        {/* Quiet Reassurance near bottom */}
        <div className="pt-4 border-t border-[#0E1E2B]/10 text-center">
          <p className="text-[11px] font-mono uppercase tracking-wider text-[#0E1E2B]/50 leading-normal">
            Your reports are securely associated with your account.
          </p>
        </div>
      </div>
    </div>
  );
};
