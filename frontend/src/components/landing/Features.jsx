import { motion } from "framer-motion";
import { Brain, Globe, Clock, Shield, Zap, MessageSquare } from "lucide-react";

const features = [
  { icon: Brain, title: "Contextual Follow-Up Questions", description: "The AI bot listens to exactly what you say and crafts the next question based on your answer — no rigid scripts, just real conversation." },
  { icon: Globe, title: "Global Coverage", description: "Works for any role at any company worldwide — tech and non-tech. No US-only limitations. Built for job seekers everywhere." },
  { icon: Clock, title: "Under 10 Minutes", description: "Complete a full AI-driven mock interview and get your detailed scored report in less than 10 minutes." },
  { icon: MessageSquare, title: "Voice-First Design", description: "Speak naturally. The AI captures, understands, and evaluates your spoken responses — then responds back like a human interviewer." },
  { icon: Zap, title: "Instant Scored Feedback", description: "Get immediate scores on answer quality, English clarity, and communication confidence with actionable improvement tips." },
  { icon: Shield, title: "Private & Judgment-Free", description: "Practice without pressure. Your sessions are private — make mistakes, try again, and build real confidence at your own pace." },
];

export default function Features() {
  return (
    <section className="py-24 lg:py-32 bg-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <p className="text-accent font-semibold text-sm tracking-wide uppercase mb-3">Why InterviewAI</p>
          <h2 className="font-space text-3xl sm:text-4xl font-bold tracking-tight">
            Your unfair advantage in interviews
          </h2>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="bg-card rounded-2xl p-6 border border-border/50 hover:border-accent/20 transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-space font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}