import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Mic, MicOff, Video, VideoOff } from 'lucide-react';

function AudioWave({ active, color = '#f97316', bars = 14 }) {
  return (
    <div className="flex items-center gap-0.5 h-5">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="w-0.5 rounded-full"
          style={{ background: color }}
          animate={active ? { height: [3, Math.random() * 14 + 4, 3] } : { height: 3 }}
          transition={
            active
              ? {
                  duration: 0.35 + Math.random() * 0.25,
                  repeat: Infinity,
                  delay: i * 0.045,
                  ease: 'easeInOut',
                }
              : {}
          }
        />
      ))}
    </div>
  );
}

/**
 * Audio/video presence panel — pinned to the top of the chat column in
 * audio/video modes. Owns the camera stream and the mic/cam toggle UI; tells
 * the parent when the user toggles either via callbacks. The actual STT
 * comes from the Composer.
 */
export default function VideoStage({
  mode,
  isInterviewerSpeaking,
  isUserSpeaking,
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  personaName,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState(null);

  useEffect(() => {
    if (mode !== 'video' || !camOn) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setCamReady(false);
      return undefined;
    }
    let cancelled = false;
    setCamError(null);
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setCamError(err?.message || 'Camera unavailable');
          setCamReady(false);
        }
      });
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [mode, camOn]);

  if (mode === 'chat') return null;

  return (
    <div className="border-b border-border/40 bg-[#0d0d14]">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-4">
        {mode === 'video' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="relative rounded-xl overflow-hidden aspect-video bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
              <AnimatePresence>
                {isInterviewerSpeaking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-gradient-to-br from-accent/20 to-transparent"
                  />
                )}
              </AnimatePresence>
              <div
                className={`relative z-10 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isInterviewerSpeaking ? 'bg-accent shadow-lg shadow-accent/40 scale-110' : 'bg-slate-700'
                }`}
              >
                <Bot className="w-7 h-7 text-white" />
              </div>
              <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                <span className="text-[11px] text-white/70 font-medium truncate">
                  {personaName || 'Interviewer'}
                </span>
                <AudioWave active={isInterviewerSpeaking} color="#f97316" />
              </div>
            </div>

            <div className="relative rounded-xl overflow-hidden aspect-video bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center">
              {camReady ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 z-10 px-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
                    <span className="text-white font-bold text-lg">Y</span>
                  </div>
                  {!camOn && (
                    <span className="text-[10px] text-white/60 mt-1">Camera off</span>
                  )}
                  {camError && (
                    <span className="text-[10px] text-rose-300 mt-1">{camError}</span>
                  )}
                </div>
              )}
              <AnimatePresence>
                {isUserSpeaking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="absolute inset-0 rounded-xl border-2 border-emerald-400/60 z-20"
                  />
                )}
              </AnimatePresence>
              <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between z-30">
                <span className="text-[11px] text-white/70">You</span>
                <AudioWave active={isUserSpeaking} color="#22c55e" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                isInterviewerSpeaking ? 'bg-accent shadow-lg shadow-accent/30 scale-105' : 'bg-white/10'
              }`}
            >
              <Bot className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/70 mb-1.5 truncate">
                {isInterviewerSpeaking
                  ? `${personaName || 'Interviewer'} is speaking…`
                  : isUserSpeaking
                    ? 'Listening…'
                    : 'Audio call'}
              </p>
              <AudioWave
                active={isInterviewerSpeaking || isUserSpeaking}
                color={isInterviewerSpeaking ? '#f97316' : '#22c55e'}
                bars={28}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            type="button"
            onClick={onToggleMic}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              micOn ? 'bg-white/10 hover:bg-white/15' : 'bg-rose-500/80 hover:bg-rose-500'
            }`}
            title={micOn ? 'Mute mic' : 'Unmute mic'}
          >
            {micOn ? (
              <Mic className="w-4 h-4 text-white/80" />
            ) : (
              <MicOff className="w-4 h-4 text-white" />
            )}
          </button>
          {mode === 'video' && (
            <button
              type="button"
              onClick={onToggleCam}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                camOn ? 'bg-white/10 hover:bg-white/15' : 'bg-rose-500/80 hover:bg-rose-500'
              }`}
              title={camOn ? 'Stop camera' : 'Start camera'}
            >
              {camOn ? (
                <Video className="w-4 h-4 text-white/80" />
              ) : (
                <VideoOff className="w-4 h-4 text-white" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
