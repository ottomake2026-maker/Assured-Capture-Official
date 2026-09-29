import React, { useState } from 'react';
import { usePWAInstall } from '../utils/usePWAInstall';
import { Download, Share2, PlusSquare, X, Smartphone } from 'lucide-react';

interface PWAInstallButtonProps {
  variant?: 'header' | 'button' | 'compact';
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header',
  className = '',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Not installable and not iOS (e.g., standard browser already with prompt handled or unsupported)
  if (!isInstallable && !isIOS) {
    return null;
  }

  return (
    <>
      {variant === 'header' && (
        <button
          type="button"
          onClick={isIOS ? () => setShowIOSGuide(true) : install}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0E1E2B] text-white hover:bg-[#1A3348] active:bg-[#0E1E2B] text-xs font-semibold tracking-wide transition-all shadow-2xs border border-white/15 cursor-pointer touch-manipulation min-h-[36px] ${className}`}
          title="Install Assured Capture to home screen"
          aria-label="Install App"
        >
          <Download className="w-3.5 h-3.5 text-[#B2E5F6] stroke-[2.5]" />
          <span className="hidden sm:inline">Install App</span>
          <span className="sm:hidden">Install</span>
        </button>
      )}

      {variant === 'compact' && (
        <button
          type="button"
          onClick={isIOS ? () => setShowIOSGuide(true) : install}
          className={`p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center ${className}`}
          title="Install Assured Capture"
          aria-label="Install App"
        >
          <Download className="w-4 h-4 text-[#B2E5F6]" />
        </button>
      )}

      {variant === 'button' && (
        <button
          type="button"
          onClick={isIOS ? () => setShowIOSGuide(true) : install}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0E1E2B] hover:bg-[#1A3348] text-white text-xs font-bold uppercase tracking-wider transition-colors border border-white/15 cursor-pointer min-h-[44px] ${className}`}
        >
          <Download className="w-4 h-4 text-[#B2E5F6]" />
          <span>Install to Home Screen</span>
        </button>
      )}

      {/* Guided installation modal for iOS Safari */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-2xl bg-[#0E1E2B] border border-white/20 p-5 shadow-2xl text-white">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#B2E5F6]" />
                <h3 className="text-sm font-bold tracking-wide uppercase">
                  Install on iOS Safari
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Close guide"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-300 leading-relaxed">
              Install <strong>Assured Capture</strong> directly onto your iPhone or iPad home screen for fast offline access in the field:
            </p>

            <div className="mt-4 space-y-3 bg-white/5 p-3.5 rounded-xl border border-white/10 text-xs text-slate-200">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-[#628EF7]/20 border border-[#628EF7]/40 flex items-center justify-center shrink-0 text-[#B2E5F6] font-bold text-xs">
                  1
                </div>
                <div>
                  Tap the <strong className="text-white">Share</strong> button{' '}
                  <Share2 className="inline w-3.5 h-3.5 text-[#B2E5F6] mx-0.5" /> in the Safari toolbar.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-[#628EF7]/20 border border-[#628EF7]/40 flex items-center justify-center shrink-0 text-[#B2E5F6] font-bold text-xs">
                  2
                </div>
                <div>
                  Scroll down and tap{' '}
                  <strong className="text-white">Add to Home Screen</strong>{' '}
                  <PlusSquare className="inline w-3.5 h-3.5 text-[#B2E5F6] mx-0.5" />.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-[#628EF7]/20 border border-[#628EF7]/40 flex items-center justify-center shrink-0 text-[#B2E5F6] font-bold text-xs">
                  3
                </div>
                <div>
                  Tap <strong className="text-white">Add</strong> in the top right corner.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-4 w-full py-2.5 px-4 rounded-lg bg-[#628EF7] hover:bg-[#4E7AF2] text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-[40px]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
