import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

export default function VoiceRecorder({ onTranscript, isProcessing, onRecordingStart, onRecordingStop }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);

  const startRecording = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert("Your browser doesn't support speech recognition. Please use Chrome or Edge.");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(finalTranscript + interim);
    };

    recognition.onerror = (event) => {
      console.log('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        stopRecording();
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        try { recognition.start(); } catch (e) {}
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setTranscript('');
    setSeconds(0);
    onRecordingStart?.();

    timerRef.current = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    onRecordingStop?.();
  }, []);

  const submitAnswer = useCallback(() => {
    stopRecording();
    if (transcript.trim()) {
      onTranscript(transcript.trim());
    }
  }, [transcript, onTranscript, stopRecording]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <AnimatePresence>
            {isRecording && (
              <>
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-red-500/20"
                />
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1.6, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
                  className="absolute inset-0 rounded-full bg-red-500/20"
                />
              </>
            )}
          </AnimatePresence>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
              isRecording
                ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30"
                : "bg-accent hover:bg-accent/90 shadow-lg shadow-accent/30"
            } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {isRecording ? (
              <Square className="w-7 h-7 text-white fill-white" />
            ) : (
              <Mic className="w-8 h-8 text-accent-foreground" />
            )}
          </button>
        </div>

        <div className="text-center">
          {isRecording ? (
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-red-500">Recording</span>
              <span className="font-mono text-sm text-muted-foreground">{formatTime(seconds)}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isProcessing ? "Processing your answer..." : "Tap to start speaking"}
            </p>
          )}
        </div>
      </div>

      {transcript && (
        <div className="bg-muted/50 rounded-2xl p-4 max-h-40 overflow-y-auto">
          <p className="text-xs font-medium text-muted-foreground mb-2">Your answer:</p>
          <p className="text-sm leading-relaxed">{transcript}</p>
        </div>
      )}

      {transcript && !isRecording && !isProcessing && (
        <Button
          onClick={submitAnswer}
          className="w-full bg-accent hover:bg-accent/90 text-accent-foreground h-12 rounded-xl font-semibold"
        >
          Submit Answer
        </Button>
      )}

      {isRecording && (
        <Button
          onClick={submitAnswer}
          className="w-full bg-accent hover:bg-accent/90 text-accent-foreground h-12 rounded-xl font-semibold"
        >
          Done — Submit Answer
        </Button>
      )}
    </div>
  );
}