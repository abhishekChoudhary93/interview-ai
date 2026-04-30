import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, MicOff, VideoOff, Mic, Video } from "lucide-react";

function AudioWave({ active, color = "#f97316", bars = 14 }) {
  return (
    <div className="flex items-center gap-0.5 h-5">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="w-0.5 rounded-full"
          style={{ background: color }}
          animate={active ? { height: [3, Math.random() * 14 + 4, 3] } : { height: 3 }}
          transition={active ? { duration: 0.35 + Math.random() * 0.25, repeat: Infinity, delay: i * 0.045, ease: "easeInOut" } : {}}
        />
      ))}
    </div>
  );
}

export default function VideoCallInterface({ interview, isBotSpeaking, isUserSpeaking, micOn, camOn, onToggleMic, onToggleCam, children }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [camReady, setCamReady] = useState(false);
  const mode = interview?.interview_mode;

  useEffect(() => {
    if (mode !== "video" || !camOn) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setCamReady(false);
      }
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamReady(true);
      })
      .catch(() => setCamReady(false));
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [mode, camOn]);

  return (
    <div className="bg-[#0d0d14] rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <Bot className="w-4 h-4 text-accent-foreground" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#0d0d14]" />
          </div>
          <div>
            <p className="text-xs font-semibold text-white">AI Interviewer</p>
            <p className="text-[10px] text-emerald-400">Live session</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          <span className="text-[10px] text-white/40 font-mono">REC</span>
        </div>
      </div>

      {/* Video panels — only for video mode */}
      {mode === "video" && (
        <div className="grid grid-cols-2 gap-2 p-3">
          {/* AI tile */}
          <div className="relative rounded-2xl overflow-hidden aspect-video bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
            <AnimatePresence>
              {isBotSpeaking && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-gradient-to-br from-accent/20 to-transparent" />
              )}
            </AnimatePresence>
            <div className={`relative z-10 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 ${
              isBotSpeaking ? "bg-accent shadow-lg shadow-accent/40 scale-110" : "bg-slate-700"
            }`}>
              <Bot className="w-7 h-7 text-white" />
            </div>
            {isBotSpeaking && (
              <motion.div className="absolute inset-0 rounded-2xl border-2 border-accent/60"
                animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1, repeat: Infinity }} />
            )}
            <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
              <span className="text-[11px] text-white/60">AI Interviewer</span>
              <AudioWave active={isBotSpeaking} color="#f97316" />
            </div>
          </div>

          {/* User tile */}
          <div className="relative rounded-2xl overflow-hidden aspect-video bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center">
            {camReady ? (
              <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className={`w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center transition-all duration-300 ${
                isUserSpeaking ? "scale-110 shadow-lg shadow-blue-500/30" : ""
              }`}>
                <span className="text-white font-bold text-xl">Y</span>
              </div>
            )}
            <AnimatePresence>
              {isUserSpeaking && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0.4, 1, 0.4] }} exit={{ opacity: 0 }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="absolute inset-0 rounded-2xl border-2 border-emerald-400/60 z-10" />
              )}
            </AnimatePresence>
            <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between z-20">
              <span className="text-[11px] text-white/60">You</span>
              <AudioWave active={isUserSpeaking} color="#22c55e" />
            </div>
          </div>
        </div>
      )}

      {/* Audio-only visual */}
      {mode === "audio" && (
        <div className="flex items-center gap-6 px-6 py-6 border-b border-white/5">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
            isBotSpeaking ? "bg-accent shadow-lg shadow-accent/30 scale-105" : "bg-white/10"
          }`}>
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-white/50 mb-2">{isBotSpeaking ? "AI Interviewer is speaking..." : isUserSpeaking ? "Listening..." : "Waiting..."}</p>
            <AudioWave active={isBotSpeaking || isUserSpeaking} color={isBotSpeaking ? "#f97316" : "#22c55e"} bars={24} />
          </div>
        </div>
      )}

      {/* Content slot (question + recorder) */}
      <div className="px-5 py-5">
        {children}
      </div>

      {/* Call controls */}
      {mode !== "chat" && (
        <div className="flex items-center justify-center gap-3 px-5 py-4 border-t border-white/5">
          <button
            onClick={onToggleMic}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${micOn ? "bg-white/10 hover:bg-white/15" : "bg-red-500/80"}`}
          >
            {micOn ? <Mic className="w-4 h-4 text-white/70" /> : <MicOff className="w-4 h-4 text-white" />}
          </button>
          {mode === "video" && (
            <button
              onClick={onToggleCam}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${camOn ? "bg-white/10 hover:bg-white/15" : "bg-red-500/80"}`}
            >
              {camOn ? <Video className="w-4 h-4 text-white/70" /> : <VideoOff className="w-4 h-4 text-white" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}