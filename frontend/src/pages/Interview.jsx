import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Bug } from 'lucide-react';
import {
  getInterview,
  updateInterview,
  startInterviewSession,
  streamInterviewSessionTurn,
  getInterviewSessionState,
  interviewSessionComplete,
} from '@/api/interviews';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import ChatThread from '@/components/interview/ChatThread';
import Composer from '@/components/interview/Composer';
import ProblemPanel from '@/components/interview/ProblemPanel';
import Scratchpad from '@/components/interview/Scratchpad';
import DesignCanvas from '@/components/interview/DesignCanvas';
import VideoStage from '@/components/interview/VideoStage';
import InterviewHeader from '@/components/interview/InterviewHeader';
import SessionDialog, { WrappingUpDialog } from '@/components/interview/SessionDialog';
import { useInterviewerVoice } from '@/hooks/useInterviewerVoice';

/**
 * Build the conversation list shown in the chat thread from the canonical
 * `conversation_turns` on the interview row. Skips empty entries.
 */
function turnsToMessages(turns) {
  if (!Array.isArray(turns)) return [];
  return turns
    .filter((t) => t && String(t.content ?? '').trim())
    .map((t) => ({
      role: String(t.role || '').toLowerCase() === 'interviewer' ? 'interviewer' : 'candidate',
      content: String(t.content),
      kind: t.kind || undefined,
    }));
}

export default function Interview() {
  const navigate = useNavigate();
  const interviewId = new URLSearchParams(window.location.search).get('id');

  const [interview, setInterview] = useState(null);
  const [interviewConfig, setInterviewConfig] = useState(null);
  const [messages, setMessages] = useState([]);

  // The candidate's bubble we render before the SSE turn lands. Cleared once
  // the server-confirmed turn arrives in `messages`.
  const [pendingCandidate, setPendingCandidate] = useState(null);
  // Streaming buffer for the interviewer; null = not currently streaming.
  // '' = streaming started, no tokens yet (typing dots show).
  const [streamingInterviewer, setStreamingInterviewer] = useState(null);

  const [isPreparing, setIsPreparing] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [isWrappingUp, setIsWrappingUp] = useState(false);

  const [railOpen, setRailOpen] = useState(true);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);

  const [confirmKind, setConfirmKind] = useState(null); // 'pause' | 'abandon' | 'end'

  const sessionStartedRef = useRef(false);
  const abortRef = useRef(null);
  // Ref into <DesignCanvas> so sendTurn can flush the autosave debounce
  // BEFORE streaming a turn — otherwise a candidate who drew + sent within
  // 800ms ships a turn whose backend canvas_text is stale.
  const canvasRef = useRef(null);
  // Timer id for the post-`done` /session/state poll that detects
  // interview_done. Backend no longer ships an inline `state` SSE event
  // (the Planner eval is fire-and-forget after res.end), so the frontend
  // polls once a few seconds after onDone to discover end-of-interview.
  // Cleared on next sendTurn / abort / unmount so we never double-fire
  // finalizeAndNavigate.
  const interviewDonePollRef = useRef(null);

  const clearInterviewDonePoll = useCallback(() => {
    if (interviewDonePollRef.current) {
      clearTimeout(interviewDonePollRef.current);
      interviewDonePollRef.current = null;
    }
  }, []);

  const mode = interview?.interview_mode || 'chat';
  const useVoiceOut = mode !== 'chat' && !voiceMuted;
  const voice = useInterviewerVoice({ enabled: useVoiceOut });

  /* ---------- bootstrap: load interview + start session ---------- */

  useEffect(() => {
    if (!interviewId) {
      navigate('/setup');
      return undefined;
    }
    let cancelled = false;
    sessionStartedRef.current = false;

    (async () => {
      try {
        let row = await getInterview(interviewId);
        if (cancelled) return;
        if (row.status === 'paused') {
          try {
            await updateInterview(interviewId, { status: 'in_progress' });
            row = await getInterview(interviewId);
          } catch {
            /* keep paused row */
          }
        }
        if (cancelled) return;
        setInterview(row);
        setMessages(turnsToMessages(row.conversation_turns));

        if (!row.template_id) {
          // Old, pre-template rows are no longer supported in the new flow.
          // Send the user back to setup with a helpful URL flag.
          navigate('/setup?legacy=1');
          return;
        }
        if (sessionStartedRef.current) return;
        sessionStartedRef.current = true;

        const session = await startInterviewSession(interviewId);
        if (cancelled) return;

        const fresh = await getInterview(interviewId);
        if (cancelled) return;
        setInterview(fresh);
        setInterviewConfig(
          session.interview_config ||
            fresh.interview_config ||
            session.execution_plan ||
            fresh.execution_plan ||
            null
        );
        setMessages(turnsToMessages(fresh.conversation_turns));

        if (mode !== 'chat' && session.interviewer_message) {
          // Speak the opening line immediately so the candidate hears it.
          voice.feedTokens(session.interviewer_message);
          voice.flushPending();
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) navigate('/dashboard');
      } finally {
        if (!cancelled) setIsPreparing(false);
      }
    })();

    return () => {
      cancelled = true;
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          /* ignore */
        }
      }
      clearInterviewDonePoll();
      voice.cancel();
    };
  }, [interviewId, navigate, clearInterviewDonePoll]);

  /* ---------- send a turn ---------- */

  /**
   * Tear down all "a turn is in flight" UI state and surface the error to
   * the user as an interviewer-side system line. Used by both the SSE
   * `error` event handler and the catch branch around streamInterviewSessionTurn.
   * Must clear isStreaming + pendingCandidate so the textarea unlocks and
   * Composer's send button leaves its disabled state — otherwise a single
   * mid-stream failure permanently freezes the session (sendTurn early-
   * returns when isStreaming is true).
   */
  const failTurnWithMessage = useCallback((msg) => {
    setStreamingInterviewer(null);
    setIsStreaming(false);
    setPendingCandidate(null);
    setMessages((prev) => [
      ...prev,
      { role: 'interviewer', content: msg, kind: 'system_error' },
    ]);
  }, []);

  const sendTurn = useCallback(
    async (text) => {
      if (!text.trim() || isStreaming) return;
      // Cancel any pending interview-done poll from a prior turn so we don't
      // race a finalize against a fresh in-flight turn.
      clearInterviewDonePoll();
      setIsProcessing(true);
      setIsStreaming(true);
      setPendingCandidate({ content: text, kind: 'answer' });
      setStreamingInterviewer(''); // typing dots until first token
      voice.cancel();

      // Flush any in-flight canvas autosave so the backend reads fresh
      // canvas_text. No-op when the canvas isn't mounted (non-system-design)
      // or when there's nothing pending. Failures here must not block the
      // turn — fall through to streaming regardless.
      try {
        await canvasRef.current?.flushPending?.();
      } catch (e) {
        console.warn('[canvas flush] failed before turn:', e);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      let assembled = '';

      try {
        await streamInterviewSessionTurn(interviewId, text, {
          signal: controller.signal,
          onMeta: () => {
            // Move the optimistic candidate bubble into the canonical list as
            // soon as the server has accepted the turn. Avoids the bubble
            // disappearing-then-reappearing when state refreshes later.
            setMessages((prev) => [...prev, { role: 'candidate', content: text, kind: 'answer' }]);
            setPendingCandidate(null);
          },
          onToken: (delta) => {
            assembled += delta;
            setStreamingInterviewer(assembled);
            if (useVoiceOut) voice.feedTokens(delta);
          },
          onDone: ({ interviewer_message }) => {
            const finalText = (interviewer_message || assembled || '').trim();
            setMessages((prev) => [
              ...prev,
              { role: 'interviewer', content: finalText, kind: 'reply' },
            ]);
            setStreamingInterviewer(null);
            setIsStreaming(false);
            if (useVoiceOut) voice.flushPending();

            // The backend Planner eval is fire-and-forget after res.end(),
            // so an inline interview_done flag is no longer streamed back.
            // Poll /session/state once after a window long enough for a
            // typical eval to land (~1-3s). If the Planner declared the
            // interview complete on this turn, auto-navigate to the report.
            interviewDonePollRef.current = setTimeout(async () => {
              interviewDonePollRef.current = null;
              try {
                const snap = await getInterviewSessionState(interviewId);
                if (snap?.session_state?.interview_done) {
                  void finalizeAndNavigate();
                }
              } catch (err) {
                // Non-fatal — the user can still End & report manually.
                console.warn('[interview_done poll] failed:', err);
              }
            }, 3000);
          },
          // Backend no longer emits an inline `state` SSE event (Planner
          // eval runs after res.end()). Kept as a no-op so a future
          // protocol revival doesn't crash the client.
          onState: () => {},
          onError: (msg) => {
            console.warn('[stream] error:', msg);
            failTurnWithMessage(
              'Sorry — the connection dropped before I could reply. Try sending your message again.'
            );
          },
        });
      } catch (e) {
        if (controller.signal.aborted) {
          // User-initiated abort — clean state silently. pendingCandidate
          // also has to clear here, otherwise the abandoned candidate bubble
          // hangs around above an empty composer.
          setStreamingInterviewer(null);
          setIsStreaming(false);
          setPendingCandidate(null);
        } else {
          // fetch reject (network down) or mid-stream reader throw. Without
          // this branch isStreaming stays true forever and every future
          // sendTurn early-returns, locking the session until reload.
          console.error('[stream] failed:', e);
          failTurnWithMessage(
            'Sorry — something went wrong sending that. Please try again.'
          );
        }
      } finally {
        setIsProcessing(false);
        abortRef.current = null;
      }
    },
    [
      interviewId,
      isStreaming,
      useVoiceOut,
      clearInterviewDonePoll,
      failTurnWithMessage,
    ]
  );

  const handleAbortStream = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        /* ignore */
      }
    }
    clearInterviewDonePoll();
    voice.cancel();
  }, [voice, clearInterviewDonePoll]);

  /* ---------- notes & canvas autosave ---------- */

  const persistNotes = useCallback(
    async (notes) => {
      if (!interviewId) return;
      try {
        await updateInterview(interviewId, { notes });
      } catch (e) {
        console.warn('[notes] save failed:', e);
      }
    },
    [interviewId]
  );

  /**
   * Persist the design canvas. Both the raw Excalidraw scene (for rehydration
   * on resume) and the textual summary (for the LLM prompt) are sent in a
   * single PATCH so they stay in sync.
   */
  const persistCanvas = useCallback(
    async ({ canvas_scene, canvas_text }) => {
      if (!interviewId) return;
      try {
        await updateInterview(interviewId, { canvas_scene, canvas_text });
      } catch (e) {
        console.warn('[canvas] save failed:', e);
      }
    },
    [interviewId]
  );

  const isSystemDesign =
    String(interview?.interview_type || '').toLowerCase() === 'system_design';

  /* ---------- end / pause / abandon ---------- */

  const finalizeAndNavigate = useCallback(async () => {
    setIsWrappingUp(true);
    try {
      // Make sure the latest eval has landed before completing.
      try {
        await getInterviewSessionState(interviewId);
      } catch {
        /* non-fatal */
      }
      await interviewSessionComplete(interviewId);
      navigate(`/report?id=${interviewId}`);
    } catch (e) {
      console.error(e);
      setIsWrappingUp(false);
    }
  }, [interviewId, navigate]);

  const onConfirmAction = useCallback(async () => {
    voice.cancel();
    if (confirmKind === 'pause') {
      try {
        await updateInterview(interviewId, { status: 'paused' });
        navigate('/dashboard');
      } finally {
        setConfirmKind(null);
      }
    } else if (confirmKind === 'abandon') {
      try {
        await updateInterview(interviewId, { status: 'abandoned' });
        navigate('/dashboard');
      } finally {
        setConfirmKind(null);
      }
    } else if (confirmKind === 'end') {
      setConfirmKind(null);
      setIsEndingSession(true);
      await finalizeAndNavigate();
      setIsEndingSession(false);
    }
  }, [confirmKind, finalizeAndNavigate, interviewId, navigate, voice]);

  const candidateTurnCount = useMemo(
    () => messages.filter((m) => m.role === 'candidate').length,
    [messages]
  );
  const canEndEarly = candidateTurnCount >= 1;

  /* ---------- render ---------- */

  if (!interview || isPreparing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Preparing your interviewer…</p>
        </div>
      </div>
    );
  }

  const confirmCopy = (() => {
    if (confirmKind === 'pause') {
      return {
        title: 'Pause this interview?',
        description: 'Your progress is saved. You can resume later from the dashboard.',
        confirm: 'Pause',
        variant: 'default',
      };
    }
    if (confirmKind === 'abandon') {
      return {
        title: 'Exit and abandon this interview?',
        description: 'The session will be marked abandoned and won’t be scored.',
        confirm: 'Abandon',
        variant: 'destructive',
      };
    }
    if (confirmKind === 'end') {
      return {
        title: 'End now and generate the report?',
        description:
          'We’ll grade everything you’ve answered so far and take you to your scored report.',
        confirm: 'End & report',
        variant: 'default',
      };
    }
    return { title: '', description: '', confirm: '', variant: 'default' };
  })();

  const debugTraceOn = import.meta.env.VITE_DEBUG_TRACE === '1';

  return (
    <div className="h-dvh flex flex-col bg-background">
      {debugTraceOn && interviewId ? (
        <Link
          to={`/interview/${encodeURIComponent(interviewId)}/debug`}
          className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-xs font-mono shadow-sm hover:border-accent/40 hover:text-accent transition-colors"
          title="Open per-turn debug timeline (local only)"
        >
          <Bug className="w-3.5 h-3.5" /> debug
        </Link>
      ) : null}
      <InterviewHeader
        interview={interview}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        onPause={() => setConfirmKind('pause')}
        onAbandon={() => setConfirmKind('abandon')}
        onEndAndReport={() => setConfirmKind('end')}
        isProcessing={isProcessing}
        isEndingSession={isEndingSession}
        canEndEarly={canEndEarly}
        showVoiceControls={mode !== 'chat'}
        voices={voice.voices}
        voiceName={voice.voiceName}
        onVoiceChange={voice.setVoiceName}
        voiceMuted={voiceMuted}
        onToggleVoiceMute={() => {
          if (!voiceMuted) voice.cancel();
          setVoiceMuted((v) => !v);
        }}
      />

      <div className="flex-1 min-h-0 flex">
        {isSystemDesign ? (
          <PanelGroup
            direction="horizontal"
            autoSaveId="interview-sd-layout"
            className="flex-1 min-w-0"
          >
            <Panel defaultSize={58} minSize={30} className="flex flex-col min-h-0">
              <DesignCanvas
                ref={canvasRef}
                initialScene={interview.canvas_scene}
                onPersist={persistCanvas}
              />
            </Panel>
            <PanelResizeHandle className="w-1.5 bg-border/30 hover:bg-accent/40 transition-colors" />
            <Panel defaultSize={42} minSize={28} className="flex flex-col min-h-0">
              <motion.main
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 min-w-0 min-h-0 flex flex-col border-l border-border/40"
              >
                <VideoStage
                  mode={mode}
                  isInterviewerSpeaking={voice.isSpeaking}
                  isUserSpeaking={isUserSpeaking}
                  micOn={micOn}
                  camOn={camOn}
                  onToggleMic={() => setMicOn((v) => !v)}
                  onToggleCam={() => setCamOn((v) => !v)}
                  personaName={interviewConfig?.interviewer?.name}
                />
                <ChatThread
                  messages={messages}
                  pendingCandidate={pendingCandidate}
                  streamingInterviewer={streamingInterviewer}
                  className="flex-1"
                />
                <Composer
                  mode={mode}
                  isSending={isProcessing && !isStreaming}
                  isStreaming={isStreaming}
                  onSubmit={sendTurn}
                  onAbort={handleAbortStream}
                  onRecordingChange={setIsUserSpeaking}
                  micEnabled={micOn}
                />
              </motion.main>
            </Panel>
          </PanelGroup>
        ) : (
          <motion.main
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 min-w-0 flex flex-col"
          >
            <VideoStage
              mode={mode}
              isInterviewerSpeaking={voice.isSpeaking}
              isUserSpeaking={isUserSpeaking}
              micOn={micOn}
              camOn={camOn}
              onToggleMic={() => setMicOn((v) => !v)}
              onToggleCam={() => setCamOn((v) => !v)}
              personaName={interviewConfig?.interviewer?.name}
            />

            <ChatThread
              messages={messages}
              pendingCandidate={pendingCandidate}
              streamingInterviewer={streamingInterviewer}
              className="flex-1"
            />

            <Composer
              mode={mode}
              isSending={isProcessing && !isStreaming}
              isStreaming={isStreaming}
              onSubmit={sendTurn}
              onAbort={handleAbortStream}
              onRecordingChange={setIsUserSpeaking}
              micEnabled={micOn}
            />
          </motion.main>
        )}

        <aside
          className={`hidden lg:flex flex-col border-l border-border/50 bg-muted/20 overflow-hidden transition-[width] duration-200 ${
            railOpen ? 'w-[320px]' : 'w-0'
          }`}
        >
          {railOpen && (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              <ProblemPanel config={interviewConfig} />
              <Scratchpad value={interview.notes || ''} onPersist={persistNotes} />
            </div>
          )}
        </aside>
      </div>

      <SessionDialog
        open={!!confirmKind}
        onOpenChange={(o) => !o && setConfirmKind(null)}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirm}
        variant={confirmCopy.variant}
        loading={isEndingSession}
        onConfirm={onConfirmAction}
      />

      <WrappingUpDialog open={isWrappingUp} />
    </div>
  );
}
