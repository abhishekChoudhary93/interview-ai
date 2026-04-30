import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Briefcase, Building2, Award, Layers, ArrowRight, ArrowLeft, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";

const experienceLevels = [
  { value: "entry", label: "Entry Level", desc: "0-2 years experience" },
  { value: "mid", label: "Mid Level", desc: "3-5 years experience" },
  { value: "senior", label: "Senior Level", desc: "6-10 years experience" },
  { value: "lead", label: "Lead / Manager", desc: "10+ years experience" },
];

const interviewTypes = [
  { value: "behavioral", label: "Behavioral", desc: "STAR method, situational questions" },
  { value: "technical", label: "Technical", desc: "Role-specific technical questions" },
  { value: "mixed", label: "Mixed", desc: "Combination of both types" },
];

const popularRoles = [
  "Software Engineer", "Product Manager", "Data Analyst", "Marketing Manager",
  "UX Designer", "Sales Representative", "Business Analyst", "Project Manager",
  "Accountant", "HR Manager", "Nurse", "Teacher",
];

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    role_title: "",
    company: "",
    experience_level: "",
    interview_type: "mixed",
    industry: "",
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const canProceed = () => {
    if (step === 1) return form.role_title.trim();
    if (step === 2) return form.company.trim();
    if (step === 3) return form.experience_level;
    return true;
  };

  const startInterview = async () => {
    setLoading(true);
    const interview = await base44.entities.Interview.create({
      ...form,
      status: "in_progress",
      questions: [],
    });
    navigate(`/interview?id=${interview.id}`);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-10">
          {[1, 2, 3, 4].map(s => (
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
              icon={<Briefcase className="w-6 h-6" />}
              title="What role are you targeting?"
              subtitle="Enter your target job title or pick from popular roles."
            >
              <Input
                placeholder="e.g., Senior Product Manager"
                value={form.role_title}
                onChange={e => set("role_title", e.target.value)}
                className="h-14 rounded-xl text-base px-5 bg-card"
              />
              <div className="flex flex-wrap gap-2 mt-4">
                {popularRoles.map(r => (
                  <button
                    key={r}
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
            </StepWrapper>
          )}

          {step === 2 && (
            <StepWrapper
              icon={<Building2 className="w-6 h-6" />}
              title="Which company?"
              subtitle="We'll tailor questions to the company's culture and interview style."
            >
              <Input
                placeholder="e.g., Google, Amazon, Deloitte..."
                value={form.company}
                onChange={e => set("company", e.target.value)}
                className="h-14 rounded-xl text-base px-5 bg-card"
              />
              <div className="mt-4">
                <Label className="text-sm text-muted-foreground">Industry (optional)</Label>
                <Input
                  placeholder="e.g., Technology, Finance, Healthcare..."
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
              title="Your experience level"
              subtitle="This helps us calibrate question difficulty."
            >
              <div className="grid grid-cols-2 gap-3">
                {experienceLevels.map(l => (
                  <button
                    key={l.value}
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
              title="Interview type"
              subtitle="Choose the type of questions you want to practice."
            >
              <div className="space-y-3">
                {interviewTypes.map(t => (
                  <button
                    key={t.value}
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
        </motion.div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-10">
          <Button
            variant="ghost"
            onClick={() => setStep(s => s - 1)}
            disabled={step === 1}
            className="gap-2 rounded-xl"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>

          {step < 4 ? (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed()}
              className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 h-12 px-8 rounded-xl font-semibold"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={startInterview}
              disabled={loading}
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