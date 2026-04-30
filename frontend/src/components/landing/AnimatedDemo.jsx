import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, MicOff, VideoOff, Phone, Sparkles, Brain } from "lucide-react";

const botMessages = [
  { text: "Tell me about a time you led a cross-functional team under pressure.", delay: 1000 },
  { text: "Interesting — how exactly did you unblock the engineering team? What was your specific decision?", delay: 7500, isFollowUp: true },
  { text: "What would you do differently to prevent that dependency risk in future projects?", delay: 13500, isFollowUp: true },
];

const userResponses = [
  { text: "We had a product launch deadline and the eng team was blocked on an API integration...", delay: 3500 },
  { text: "I escalated directly to the vendor and negotiated a 48-hour priority fix while re-scoping the MVP.", delay: 9800 },
];

const videoScores = [
  { label: "Answer Quality", score: 88, color: "#6366f1" },
  { label: "Eye Contact", score: 91, color: "#22c55e" },
  { label: "Body Language", score: 79, color: "#f97316" },
  { label: "Vocal Confidence", score: 85, color: "#a855f7" },
];

function AudioWave({ active, color = "#f97316", bars = 12 }) {
  return (
    <div className="flex items-center gap-0.5 h-6">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="w-0.5 rounded-full"
          style={{ background: color }}
          animate={active ? {
            height: [4, Math.random() * 16 + 4, 4],
          } : { height: 3 }}
          transition={active ? {
            duration: 0.4 + Math.random() * 0.3,
            repeat: Infinity,
            delay: i * 0.04,
            ease: "easeInOut",
          } : {}}
        />
      ))}
    </div>
  );
}

export default function AnimatedDemo() {
  const [phase, setPhase] = useState(0);
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [currentBotMsg, setCurrentBotMsg] = useState(null);
  const [showScores, setShowScores] = useState(false);
  const [callTime, setCallTime] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    let timeouts = [];
    setPhase(0);
    setShowScores(false);
    setCurrentBotMsg(null);
    setCallTime(0);
    setBotSpeaking(false);
    setUserSpeaking(false);

    // Timer
    timerRef.current = setInterval(() => setCallTime(t => t + 1), 1000);

    // Bot speaks
    botMessages.forEach((msg, i) => {
      const startT = setTimeout(() => { setBotSpeaking(true); setCurrentBotMsg(msg); }, msg.delay);
      const stopT = setTimeout(() => setBotSpeaking(false), msg.delay + 2200);
      timeouts.push(startT, stopT);
    });

    // User speaks
    userResponses.forEach((_, i) => {
      const startT = setTimeout(() => setUserSpeaking(true), userResponses[i].delay);
      const stopT = setTimeout(() => setUserSpeaking(false), userResponses[i].delay + 2800);
      timeouts.push(startT, stopT);
    });

    // Show scores
    const scoreT = setTimeout(() => setShowScores(true), 17000);
    timeouts.push(scoreT);

    // Reset loop
    const resetT = setTimeout(() => {
      clearInterval(timerRef.current);
      setPhase(p => p + 1);
    }, 22000);
    timeouts.push(resetT);

    return () => {
      timeouts.forEach(clearTimeout);
      clearInterval(timerRef.current);
    };
  }, [phase]);

  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <section className="py-24 lg:py-32 bg-primary overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20 mb-6">
              <Brain className="w-4 h-4 text-accent" />
              <span className="text-accent text-sm font-medium">Real Interview Experience</span>
            </div>
            <h2 className="font-space text-3xl sm:text-4xl font-bold text-primary-foreground tracking-tight">
              It's a real
              <br />
              interview call.
              <br />
              <span className="text-accent">Not a quiz.</span>
            </h2>
            <p className="mt-5 text-primary-foreground/60 text-lg leading-relaxed">
              Practice via video call, audio-only, or chat. The AI bot sees your body language, hears your tone, and fires back with intelligent follow-ups — just like a real interviewer.
            </p>

            <div className="mt-8 space-y-4">
              {[
                { icon: "📹", mode: "Video Mode", desc: "Full video call experience. AI evaluates body language, eye contact, and facial confidence alongside your answers." },
                { icon: "🎙️", mode: "Audio Mode", desc: "Voice-first. Speak naturally and get scored on vocal tone, clarity, and communication confidence." },
                { icon: "💬", mode: "Chat Mode", desc: "Prefer typing? Chat fallback available. All the same intelligent follow-ups, just in text." },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.12 }}
                  className="flex items-start gap-4"
                >
                  <span className="text-2xl">{item.icon}</span>
                  <div>
                    <p className="font-semibold text-primary-foreground text-sm">{item.mode}</p>
                    <p className="text-primary-foreground/50 text-sm">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Right: animated video call */}
          <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
            <div className="bg-[#0d0d14] rounded-3xl overflow-hidden shadow-2xl border border-white/5">
              {/* Top bar */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs text-white/50 font-mono">{formatTime(callTime)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
              </div>

              {/* Video grid */}
              <div className="grid grid-cols-2 gap-2 p-3">
                {/* AI Interviewer */}
                <div className="relative rounded-2xl overflow-hidden aspect-video bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
                  {/* Animated gradient bg when speaking */}
                  <AnimatePresence>
                    {botSpeaking && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-gradient-to-br from-accent/20 to-transparent"
                      />
                    )}
                  </AnimatePresence>
                  <div className={`relative z-10 w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 ${
                    botSpeaking ? "bg-accent shadow-lg shadow-accent/40 scale-110" : "bg-slate-700"
                  }`}>
                    <Bot className="w-8 h-8 text-white" />
                  </div>
                  {/* Speaking ring */}
                  {botSpeaking && (
                    <motion.div
                      className="absolute inset-0 rounded-2xl border-2 border-accent/60"
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  )}
                  <div className="absolute bottom-2 left-3 right-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/70 font-medium">AI Interviewer</span>
                      <AudioWave active={botSpeaking} color="#f97316" bars={10} />
                    </div>
                  </div>
                </div>

                {/* User */}
                <div className="relative rounded-2xl overflow-hidden aspect-video bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center">
                  <AnimatePresence>
                    {userSpeaking && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent"
                      />
                    )}
                  </AnimatePresence>
                  <div className={`relative z-10 w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center transition-all duration-300 ${
                    userSpeaking ? "scale-110 shadow-lg shadow-blue-500/30" : ""
                  }`}>
                    <span className="text-white font-bold text-xl">Y</span>
                  </div>
                  {userSpeaking && (
                    <motion.div
                      className="absolute inset-0 rounded-2xl border-2 border-emerald-400/60"
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  )}
                  <div className="absolute bottom-2 left-3 right-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/70 font-medium">You</span>
                      <AudioWave active={userSpeaking} color="#22c55e" bars={10} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bot message bubble */}
              <div className="px-4 pb-3 min-h-[72px]">
                <AnimatePresence mode="wait">
                  {currentBotMsg && (
                    <motion.div
                      key={currentBotMsg.text}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="bg-white/5 rounded-2xl px-4 py-3"
                    >
                      {currentBotMsg.isFollowUp && (
                        <p className="text-[10px] text-accent font-semibold flex items-center gap-1 mb-1">
                          <Sparkles className="w-3 h-3" /> Follow-up question
                        </p>
                      )}
                      <p className="text-white/80 text-xs leading-relaxed">{currentBotMsg.text}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Score reveal */}
              <AnimatePresence>
                {showScores && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="border-t border-white/5 px-4 py-4 bg-white/3"
                  >
                    <p className="text-[11px] font-semibold text-white/50 mb-3 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-accent" /> AI Evaluation Complete
                    </p>
                    <div className="space-y-2">
                      {videoScores.map((s, i) => (
                        <motion.div
                          key={s.label}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.12 }}
                          className="flex items-center gap-3"
                        >
                          <span className="text-[11px] text-white/50 w-28">{s.label}</span>
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${s.score}%` }}
                              transition={{ duration: 0.9, delay: i * 0.12 + 0.2 }}
                              className="h-full rounded-full"
                              style={{ background: s.color }}
                            />
                          </div>
                          <span className="text-[11px] font-bold w-6 text-right" style={{ color: s.color }}>{s.score}</span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Call controls */}
              <div className="flex items-center justify-center gap-3 px-5 py-4 border-t border-white/5">
                <button className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/15 transition-colors">
                  <MicOff className="w-4 h-4 text-white/60" />
                </button>
                <button className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/15 transition-colors">
                  <VideoOff className="w-4 h-4 text-white/60" />
                </button>
                <button className="w-12 h-10 rounded-xl bg-red-500 flex items-center justify-center">
                  <Phone className="w-4 h-4 text-white rotate-[135deg]" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}