import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, AlertCircle, Volume2, CheckCircle2, Loader2 } from 'lucide-react';

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
  const recognitionRef = useRef<any>(null);
  const isSupportedRef = useRef<boolean>(true);

  useEffect(() => {
    // Check Web Speech API support
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      isSupportedRef.current = false;
      setVoiceState('unavailable');
      setErrorMessage(
        'Speech recognition is not supported by this browser engine. Chrome, Edge, or Safari iOS 14.5+ are recommended for field voice transcription.'
      );
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }
    };
  }, []);

  const startListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceState('unavailable');
      setErrorMessage(
        'Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.'
      );
      return;
    }

    setErrorMessage(null);
    setInterimText('');

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setVoiceState('listening');
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
        }

        if (finalTrans) {
          setVoiceState('processing');
          setInterimText('');
          onTranscriptReceived(finalTrans.trim());
        }
      };

      recognition.onspeechend = () => {
        setVoiceState('processing');
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error event:', event.error);
        if (event.error === 'no-speech') {
          setErrorMessage('No speech detected. Please tap and speak clearly into the microphone.');
          setVoiceState('error');
        } else if (event.error === 'not-allowed') {
          setErrorMessage('Microphone access was denied. Please allow microphone permissions in your browser.');
          setVoiceState('error');
        } else if (event.error === 'network') {
          setErrorMessage('Network connection error during voice transcription service.');
          setVoiceState('error');
        } else {
          setErrorMessage(`Speech recognition error: ${event.error || 'Unknown'}`);
          setVoiceState('error');
        }
      };

      recognition.onend = () => {
        // Return to ready unless in error or unavailable
        setVoiceState(prev => (prev === 'error' || prev === 'unavailable' ? prev : 'ready'));
      };

      recognition.start();
    } catch (err: any) {
      console.error('Failed to start speech recognition:', err);
      setErrorMessage(err.message || 'Unable to start speech recognition engine.');
      setVoiceState('error');
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
    }
    setVoiceState('processing');
  };

  const toggleVoice = () => {
    if (voiceState === 'listening') {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div className="w-full space-y-2.5">
      {/* Primary Prominent Voice Action Button - Outdoor / Glove Friendly */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleVoice}
          disabled={disabled || voiceState === 'unavailable'}
          className={`flex-1 flex items-center justify-center gap-3 px-5 py-3 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[48px] shadow-2xs transition-colors touch-manipulation active:scale-[0.98] cursor-pointer ${
            voiceState === 'listening'
              ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse ring-4 ring-rose-200'
              : voiceState === 'processing'
              ? 'bg-amber-600 text-white cursor-wait'
              : voiceState === 'unavailable'
              ? 'bg-[#F4F6F8] text-[#0E1E2B]/40 border border-[#0E1E2B]/15 cursor-not-allowed'
              : 'bg-[#0E1E2B] hover:bg-[#1A2E3D] text-white hover:shadow-xs'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          aria-label={
            voiceState === 'listening'
              ? 'Stop voice recording'
              : 'Describe photo by voice'
          }
        >
          {voiceState === 'listening' ? (
            <>
              <MicOff className="w-4 h-4 animate-bounce" />
              <span>Listening... Tap to Stop</span>
            </>
          ) : voiceState === 'processing' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Processing Voice...</span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 text-[#B2E5F6]" />
              <span>Describe by Voice</span>
            </>
          )}
        </button>
      </div>

      {/* Voice Status State Indicator (Only displayed when active or error) */}
      {voiceState !== 'ready' && (
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-1.5 font-medium">
            {voiceState === 'listening' && (
              <span className="inline-flex items-center gap-1 text-rose-700 font-bold animate-pulse">
                <Volume2 className="w-3.5 h-3.5 text-rose-600" />
                Listening...
              </span>
            )}
            {voiceState === 'processing' && (
              <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                Converting speech to text...
              </span>
            )}
            {voiceState === 'error' && (
              <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                Error (Tap to retry)
              </span>
            )}
            {voiceState === 'unavailable' && (
              <span className="inline-flex items-center gap-1 text-[#0E1E2B]/40 font-bold">
                <AlertCircle className="w-3.5 h-3.5 text-[#0E1E2B]/40" />
                Unavailable in browser
              </span>
            )}
          </div>
        </div>
      )}

      {/* Live Interim Transcript Feedback */}
      {interimText && (
        <div className="p-3 bg-[#B2E5F6]/20 border border-[#B2E5F6] rounded-lg text-[#0E1E2B] text-sm italic">
          <span className="font-bold not-italic text-xs block text-[#0E1E2B]/70 mb-0.5">Hearing:</span>
          "{interimText}..."
        </div>
      )}

      {/* Actionable Error Notice */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">{errorMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
};
