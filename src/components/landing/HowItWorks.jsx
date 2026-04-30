import { motion } from "framer-motion";
import { Target, Mic, BarChart3, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: Target,
    title: "Pick Your Target",
    description: "Select your dream role, company, experience level, and interview type — behavioral, technical, or mixed. The AI tailors everything to your context.",
    color: "bg-blue-500/10 text-blue-500",
  },
  {
    icon: Mic,
    title: "Talk to the AI Bot",
    description: "Speak your answers out loud. The AI bot listens, understands your response, and fires back with a contextual follow-up — drilling into specifics just like a real interviewer would.",
    color: "bg-accent/10 text-accent",
  },
  {
    icon: BarChart3,
    title: "Get Your Report",
    description: "Receive a detailed scored report on answer quality, English clarity, and communication confidence — in under 10 minutes.",
    color: "bg-emerald-500/10 text-emerald-500",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 lg:py-32 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <p className="text-accent font-semibold text-sm tracking-wide uppercase mb-3">Simple Process</p>
          <h2 className="font-space text-3xl sm:text-4xl font-bold tracking-tight">
            Ready in 3 simple steps
          </h2>
          <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
            No sign-up friction. No complex setup. Just pick, practice, and improve.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="relative"
            >
              <div className="bg-card rounded-3xl p-8 border border-border/50 hover:border-accent/20 hover:shadow-xl hover:shadow-accent/5 transition-all duration-300 h-full">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`w-12 h-12 rounded-2xl ${step.color} flex items-center justify-center`}>
                    <step.icon className="w-6 h-6" />
                  </div>
                  <span className="font-space text-5xl font-bold text-muted/80">0{i + 1}</span>
                </div>
                <h3 className="font-space text-xl font-semibold mb-3">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
              {i < steps.length - 1 && (
                <div className="hidden md:flex absolute top-1/2 -right-6 lg:-right-8 -translate-y-1/2 z-10">
                  <ArrowRight className="w-5 h-5 text-border" />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}