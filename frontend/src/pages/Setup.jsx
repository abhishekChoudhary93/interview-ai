import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Building2,
  Award,
  Layers,
  ArrowRight,
  ArrowLeft,
  Mic,
  MessageSquare,
  Video,
  Headphones,
  Cpu,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInterview } from '@/api/interviews';
import { useAuth } from '@/lib/AuthContext';

const experienceLevels = [
  { value: "entry", label: "Entry / L3", desc: "0–2 years (or equivalent)" },
  { value: "mid", label: "Mid / L4", desc: "3–5 years" },
  { value: "senior", label: "Senior / L5", desc: "6–10 years" },
  { value: "lead", label: "Staff+ / L6+", desc: "10+ years, scope at org level" },
];

/** System design, behavioral, mixed — technology interviews only */
const interviewTypes = [
  {
    value: "system_design",
    label: "System design",
    desc: "Architecture, scale, trade-offs, APIs, storage, failure modes.",
  },
  {
    value: "behavioral",
    label: "Behavioral",
    desc: "STAR stories: scope, conflict, delivery, leadership, mentoring.",
  },
  {
    value: "mixed",
    label: "Mixed",
    desc: "Alternating system-design depth with behavioral prompts.",
  },
];

const experienceModes = [
  {
    value: "chat",
    label: "Chat",
    desc: "Type your answers. Best for focus and accessibility.",
    icon: MessageSquare,
  },
  {
    value: "audio",
    label: "Audio",
    desc: "Speak your answers — voice only, no camera.",
    icon: Headphones,
  },
  {
    value: "video",
    label: "Video",
    desc: "Camera + mic — closest to a real video interview.",
    icon: Video,
  },
];

const IC_ROLE_CHIPS = [
  "Software Engineer",
  "Senior Software Engineer",
  "Staff Engineer",
  "Principal Engineer",
  "Backend Engineer",
  "Frontend Engineer",
  "Full Stack Engineer",
  "Infrastructure / SRE",
  "ML Engineer",
];

const SDM_ROLE_CHIPS = [
  "Engineering Manager",
  "Senior Engineering Manager",
  "Software Development Manager (SDM)",
  "Director of Engineering",
  "VP Engineering",
];

export default function Setup() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    role_track: "",
    role_title: "",
    company: "",
    experience_level: "",
    interview_type: "",
    industry: "",
    interview_mode: "",
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const canProceed = () => {
    if (step === 1) return Boolean(form.role_track && form.role_title.trim());
    if (step === 2) return form.company.trim();
    if (step === 3) return form.experience_level;
    if (step === 4) return Boolean(form.interview_type);
    if (step === 5) return Boolean(form.interview_mode);
    return true;
  };

  const roleChips = form.role_track === "sdm" ? SDM_ROLE_CHIPS : form.role_track === "ic" ? IC_ROLE_CHIPS : [];

  const handleBack = () => {
    if (step > 1) {
      setStep(s => s - 1);
      return;
    }
    navigate(isAuthenticated ? '/dashboard' : '/');
  };

  const startInterview = async () => {
    setLoading(true);
    const interview = await createInterview({
      ...form,
      status: "in_progress",
      questions: [],
    });
    navigate(`/interview?id=${interview.id}`);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-10">
          {[1, 2, 3, 4, 5].map(s => (
            <div key={s} className="flex-1 flex items-center gap-2">
              <div className={`h-1.5 rounded-full flex-1 transition-colors duration-300 ${
                s <= step ? "bg-accent" : "bg-muted"
              }`} />
            </div>
          ))}
        </div>

        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          {step === 1 && (
            <StepWrapper
              icon={<Cpu className="w-6 h-6" />}
              title="Technology track"
              subtitle="Practice for IC (individual contributor) or SDM / engineering leadership roles — we only support tech interviews for now."
            >
              <div className="grid grid-cols-2 gap-3 mb-6">
                <button
                  type="button"
                  onClick={() => set("role_track", "ic")}
                  className={`p-4 rounded-2xl border text-left transition-all duration-200 flex flex-col gap-2 ${
                    form.role_track === "ic"
                      ? "bg-accent/10 border-accent/30 ring-2 ring-accent/20"
                      : "bg-card border-border hover:border-accent/20"
                  }`}
                >
                  <Cpu className="w-5 h-5 text-accent" />
                  <p className="font-semibold text-sm">Individual contributor</p>
                  <p className="text-xs text-muted-foreground">IC — hands-on design & delivery</p>
                </button>
                <button
                  type="button"
                  onClick={() => set("role_track", "sdm")}
                  className={`p-4 rounded-2xl border text-left transition-all duration-200 flex flex-col gap-2 ${
                    form.role_track === "sdm"
                      ? "bg-accent/10 border-accent/30 ring-2 ring-accent/20"
                      : "bg-card border-border hover:border-accent/20"
                  }`}
                >
                  <UsersRound className="w-5 h-5 text-accent" />
                  <p className="font-semibold text-sm">SDM / leadership</p>
                  <p className="text-xs text-muted-foreground">Managers & senior tech leads</p>
                </button>
              </div>

              <Label className="text-sm text-muted-foreground">Role title</Label>
              <Input
                placeholder={form.role_track === "sdm" ? "e.g., Engineering Manager" : "e.g., Senior Software Engineer"}
                value={form.role_title}
                onChange={e => set("role_title", e.target.value)}
                className="h-14 rounded-xl text-base px-5 bg-card mt-2"
                disabled={!form.role_track}
              />
              {form.role_track ? (
                <div className="flex flex-wrap gap-2 mt-4">
                  {roleChips.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => set("role_title", r)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        form.role_title === r
                          ? "bg-accent/10 border-accent/30 text-accent"
                          : "bg-card border-border hover:border-accent/20 text-muted-foreground"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              ) : null}
            </StepWrapper>
          )}

          {step === 2 && (
            <StepWrapper
              icon={<Building2 className="w-6 h-6" />}
              title="Target company"
              subtitle="We’ll tune examples toward companies like yours (Big Tech, startup, enterprise)."
            >
              <Input
                placeholder="e.g., Stripe, Meta, Series B startup..."
                value={form.company}
                onChange={e => set("company", e.target.value)}
                className="h-14 rounded-xl text-base px-5 bg-card"
              />
              <div className="mt-4">
                <Label className="text-sm text-muted-foreground">Tech domain (optional)</Label>
                <Input
                  placeholder="e.g., SaaS, AI/ML platform, cloud infra, fintech..."
                  value={form.industry}
                  onChange={e => set("industry", e.target.value)}
                  className="h-12 rounded-xl mt-2 bg-card"
                />
              </div>
            </StepWrapper>
          )}

          {step === 3 && (
            <StepWrapper
              icon={<Award className="w-6 h-6" />}
              title="Experience band"
              subtitle="Maps to typical leveling bands — we calibrate depth and expectations."
            >
              <div className="grid grid-cols-2 gap-3">
                {experienceLevels.map(l => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => set("experience_level", l.value)}
                    className={`p-4 rounded-2xl border text-left transition-all duration-200 ${
                      form.experience_level === l.value
                        ? "bg-accent/10 border-accent/30 ring-2 ring-accent/20"
                        : "bg-card border-border hover:border-accent/20"
                    }`}
                  >
                    <p className="font-semibold text-sm">{l.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{l.desc}</p>
                  </button>
                ))}
              </div>
            </StepWrapper>
          )}

          {step === 4 && (
            <StepWrapper
              icon={<Layers className="w-6 h-6" />}
              title="Interview focus"
              subtitle="What kind of loop are you preparing for?"
            >
              <div className="space-y-3">
                {interviewTypes.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set("interview_type", t.value)}
                    className={`w-full p-5 rounded-2xl border text-left transition-all duration-200 ${
                      form.interview_type === t.value
                        ? "bg-accent/10 border-accent/30 ring-2 ring-accent/20"
                        : "bg-card border-border hover:border-accent/20"
                    }`}
                  >
                    <p className="font-semibold">{t.label}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
                  </button>
                ))}
              </div>
            </StepWrapper>
          )}

          {step === 5 && (
            <StepWrapper
              icon={<Mic className="w-6 h-6" />}
              title="How do you want to practice?"
              subtitle="Chat, audio-only, or full video — pick what matches your real interview."
            >
              <div className="space-y-3">
                {experienceModes.map(({ value, label, desc, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set("interview_mode", value)}
                    className={`w-full p-5 rounded-2xl border text-left transition-all duration-200 flex gap-4 items-start ${
                      form.interview_mode === value
                        ? "bg-accent/10 border-accent/30 ring-2 ring-accent/20"
                        : "bg-card border-border hover:border-accent/20"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <p className="font-semibold">{label}</p>
                      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </StepWrapper>
          )}
        </motion.div>

        <div className="flex items-center justify-between mt-10 gap-4">
          <Button
            type="button"
            variant="ghost"
            onClick={handleBack}
            className="gap-2 rounded-xl min-h-11 px-4"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>

          {step < 5 ? (
            <Button
              type="button"
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed()}
              className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 h-12 px-8 rounded-xl font-semibold"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={startInterview}
              disabled={loading || !canProceed()}
              className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 h-12 px-8 rounded-xl font-semibold"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
              ) : (
                <>
                  <Mic className="w-4 h-4" /> Start Interview
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepWrapper({ icon, title, subtitle, children }) {
  return (
    <div>
      <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent mb-6">
        {icon}
      </div>
      <h2 className="font-space text-2xl font-bold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-2 mb-8">{subtitle}</p>
      {children}
    </div>
  );
}
