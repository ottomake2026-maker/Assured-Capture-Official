import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, AlertCircle, Volume2, Loader2, Square, X, RotateCcw } from 'lucide-react';

interface VoiceTranscriptionControlProps {
  onTranscriptReceived: (transcript: string) => void;
  disabled?: boolean;
}

export type VoiceState = 'ready' | 'listening' | 'processing' | 'error' | 'unavailable';

export const VoiceTranscriptionControl: React.FC<VoiceTranscriptionControlProps> = ({
  onTranscriptReceived,
  disabled = false,
}) => {
  const [voiceState, setVoiceState] = useState<VoiceState>('ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [interimText, setInterimText] = useState<string>('');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const recognitionRef = useRef<any>(null);
  const isSupportedRef = useRef<boolean>(true);

  const interimTextRef = useRef<string>('');
  const watchdogTimerRef = useRef<any>(null);
  const timerIntervalRef = useRef<any>(null);

  const clearWatchdog = () => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  };

  const startTimer = () => {
    setElapsedSeconds(0);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  useEffect(() => {
    // Check Web Speech API support
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;

    if (!SpeechRecognition) {
      isSupportedRef.current = false;
      setVoiceState('unavailable');
      if (isIOS && isStandalone) {
        setErrorMessage(
          'Voice input is restricted in iOS Home Screen app mode. You can continue typing directly, or open Assured Capture in Safari for voice input.'
        );
      } else {
        setErrorMessage(
          'Speech recognition is not supported in this browser. You can continue typing your observation directly.'
        );
      }
    }

    // Safely abort voice recognition on tab switch or screen lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
        recognitionRef.current = null;
        clearWatchdog();
        stopTimer();
        setVoiceState('ready');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearWatchdog();
      stopTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
        recognitionRef.current = null;
      }
    };
  }, []);

  const startListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceState('unavailable');
      setErrorMessage(
        'Speech recognition is not supported in this browser. You can continue typing your observation.'
      );
      return;
    }

    setErrorMessage(null);
    setInterimText('');
    interimTextRef.current = '';
    clearWatchdog();

    try {
      // Abort and clean up any existing session before creating a fresh one
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
        recognitionRef.current = null;
      }

      // Create a fresh SpeechRecognition instance for each user tap (essential for iOS Safari)
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';
      recognition.maxAlternatives = 1;

      let finalReceived = false;

      // Watchdog timeout to prevent voice state from hanging indefinitely on iOS Safari
      watchdogTimerRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (_) {}
        }
        stopTimer();
        setVoiceState(prev => (prev === 'listening' || prev === 'processing' ? 'ready' : prev));
      }, 25000);

      recognition.onstart = () => {
        setVoiceState('listening');
        startTimer();
      };

      recognition.onresult = (event: any) => {
        let finalTrans = '';
        let interimTrans = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTrans += item[0].transcript;
          } else {
            interimTrans += item[0].transcript;
          }
        }

        if (interimTrans) {
          setInterimText(interimTrans);
          interimTextRef.current = interimTrans;
        }

        if (finalTrans) {
          finalReceived = true;
          clearWatchdog();
          stopTimer();
          setVoiceState('processing');
          setInterimText('');
          interimTextRef.current = '';
          onTranscriptReceived(finalTrans.trim());
        }
      };

      recognition.onspeechend = () => {
        stopTimer();
        setVoiceState('processing');
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error event:', event.error);
        clearWatchdog();
        stopTimer();
        const errType = event.error;

        if (errType === 'no-speech') {
          setErrorMessage('No speech detected. Please tap retry and speak clearly into the microphone.');
          setVoiceState('error');
        } else if (errType === 'not-allowed' || errType === 'service-not-allowed') {
          setErrorMessage('Microphone access was denied. Please allow microphone permissions in browser settings.');
          setVoiceState('error');
        } else if (errType === 'audio-capture') {
          setErrorMessage('Microphone is unavailable or in use by another app.');
          setVoiceState('error');
        } else if (errType === 'network') {
          setErrorMessage('Network connection error during voice transcription service.');
          setVoiceState('error');
        } else if (errType === 'aborted') {
          // If aborted after capturing partial text, deliver partial text
          if (interimTextRef.current && !finalReceived) {
            onTranscriptReceived(interimTextRef.current.trim());
            interimTextRef.current = '';
            setInterimText('');
          }
          setVoiceState('ready');
        } else {
          setErrorMessage('Voice input was interrupted. You can tap to try again or continue typing.');
          setVoiceState('error');
        }
      };

      recognition.onend = () => {
        clearWatchdog();
        stopTimer();
        // If recognition ended with uncommitted interim text, preserve and deliver it
        if (interimTextRef.current && !finalReceived) {
          onTranscriptReceived(interimTextRef.current.trim());
          interimTextRef.current = '';
          setInterimText('');
        }
        recognitionRef.current = null;
        setVoiceState(prev => (prev === 'error' || prev === 'unavailable' ? prev : 'ready'));
      };

      // Must be invoked synchronously directly within user gesture
      recognition.start();
    } catch (err: any) {
      clearWatchdog();
      stopTimer();
      console.error('Failed to start speech recognition synchronously:', err);
      setErrorMessage('Unable to start voice recognition in this browser. You can continue typing directly.');
      setVoiceState('error');
    }
  };

  const stopListening = () => {
    stopTimer();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
    }
    setVoiceState('processing');
  };

  const cancelListening = () => {
    stopTimer();
    clearWatchdog();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }
    setInterimText('');
    interimTextRef.current = '';
    setVoiceState('ready');
    setErrorMessage(null);
  };

  return (
    <div className="w-full space-y-2.5">
      {/* 1. READY STATE: Primary Prominent Voice Action Button */}
      {voiceState === 'ready' && (
        <button
          type="button"
          onClick={startListening}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-lg font-bold text-xs sm:text-sm uppercase tracking-wider min-h-[48px] bg-[#0E1E2B] hover:bg-[#1A2E3D] active:bg-[#06121B] text-white shadow-2xs hover:shadow-xs transition-all touch-manipulation active:scale-[0.99] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#628EF7]/30"
          aria-label="Describe photo by voice"
        >
          <Mic className="w-4 h-4 text-[#B2E5F6]" />
          <span>Describe by Voice</span>
        </button>
      )}

      {/* 2. RECORDING ACTIVE STATE: Communicates microphone is active with timer and clear Stop/Cancel */}
      {voiceState === 'listening' && (
        <div className="space-y-2.5 p-3 sm:p-3.5 bg-rose-50/70 border border-rose-200 rounded-xl">
          <div className="flex items-center justify-between px-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600" />
              </span>
              <span className="font-mono font-bold text-rose-700 uppercase tracking-wider">
                Microphone Active
              </span>
            </div>
            <span className="font-mono font-bold text-xs bg-white text-rose-700 px-2.5 py-0.5 rounded border border-rose-200 shadow-2xs">
              {formatDuration(elapsedSeconds)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={stopListening}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-bold text-xs sm:text-sm uppercase tracking-wider min-h-[48px] bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-xs transition-colors touch-manipulation active:scale-[0.99] cursor-pointer ring-2 ring-rose-300"
              aria-label="Stop recording and transcribe"
            >
              <Square className="w-4 h-4 fill-white stroke-none" />
              <span>Stop &amp; Transcribe</span>
            </button>

            <button
              type="button"
              onClick={cancelListening}
              className="flex items-center justify-center gap-1.5 px-3.5 py-3 rounded-lg font-semibold text-xs text-[#0E1E2B]/75 hover:text-[#0E1E2B] bg-white hover:bg-[#F4F6F8] active:bg-[#E5E8EB] border border-[#0E1E2B]/20 min-h-[48px] transition-colors touch-manipulation cursor-pointer shadow-2xs"
              aria-label="Cancel recording"
              title="Cancel recording"
            >
              <X className="w-4 h-4" />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. TRANSCRIBING STATE: Temporary state preventing duplicate submission */}
      {voiceState === 'processing' && (
        <div
          className="w-full flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-lg font-bold text-xs sm:text-sm uppercase tracking-wider min-h-[48px] bg-amber-600 text-white shadow-xs select-none cursor-wait"
          aria-live="polite"
        >
          <Loader2 className="w-4 h-4 animate-spin text-white" />
          <span>Transcribing audio…</span>
        </div>
      )}

      {/* 4. ERROR STATE: Clear readable error with obvious Retry button and state preserved */}
      {voiceState === 'error' && (
        <div className="space-y-2.5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-0.5">
              <span className="font-bold text-xs text-rose-900 block">Voice Transcription Notice</span>
              <p className="text-xs text-rose-800 leading-relaxed">{errorMessage || 'Voice input was interrupted.'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={startListening}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[44px] bg-[#0E1E2B] hover:bg-[#1A2E3D] text-white transition-colors cursor-pointer touch-manipulation shadow-2xs"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#B2E5F6]" />
              <span>Retry Voice Input</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setVoiceState('ready');
                setErrorMessage(null);
              }}
              className="px-3.5 py-2.5 rounded-lg font-semibold text-xs text-[#0E1E2B]/75 hover:text-[#0E1E2B] bg-white border border-[#0E1E2B]/20 min-h-[44px] transition-colors cursor-pointer touch-manipulation"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* 5. UNAVAILABLE STATE */}
      {voiceState === 'unavailable' && (
        <div className="p-3 bg-[#F4F6F8] border border-[#0E1E2B]/15 rounded-lg text-xs text-[#0E1E2B]/75 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-[#0E1E2B]/50 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block text-[#0E1E2B]">Voice Input Unavailable</span>
            <span className="text-[11px] leading-relaxed text-[#0E1E2B]/70">{errorMessage || 'Speech recognition is not supported in this browser. Please type directly.'}</span>
          </div>
        </div>
      )}

      {/* Live Interim Transcript Feedback */}
      {interimText && (
        <div className="p-3 bg-[#B2E5F6]/20 border border-[#B2E5F6] rounded-lg text-[#0E1E2B] text-xs sm:text-sm italic">
          <span className="font-bold not-italic text-[11px] font-mono uppercase tracking-wider block text-[#0E1E2B]/70 mb-0.5">
            Hearing:
          </span>
          "{interimText}..."
        </div>
      )}
    </div>
  );
};
