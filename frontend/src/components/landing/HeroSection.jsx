import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, Mic, Sparkles, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-primary min-h-[90vh] flex items-center">
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-20 left-10 w-72 h-72 bg-accent rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-500 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20 mb-8">
              <Globe className="w-4 h-4 text-accent" />
              <span className="text-accent text-sm font-medium">Video · Audio · Chat — AI interview bot, globally</span>
            </div>

            <h1 className="font-space text-4xl sm:text-5xl lg:text-6xl font-bold text-primary-foreground leading-tight tracking-tight">
              Your AI interviewer
              <br />
              <span className="text-accent">asks deeper.</span>
              <br />
              You improve faster.
            </h1>

            <p className="mt-6 text-lg text-primary-foreground/60 max-w-lg leading-relaxed">
              Join a live video or audio call with an AI interviewer that listens, probes deeper with follow-up questions, and evaluates your body language, tone, and answers — all in under 10 minutes.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link to="/setup">
                <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold px-8 h-14 text-base rounded-2xl gap-2 shadow-lg shadow-accent/25">
                  Start Free Interview
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button size="lg" variant="outline" className="border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/5 h-14 text-base rounded-2xl px-8">
                  See How It Works
                </Button>
              </a>
            </div>

            <div className="mt-12 flex items-center gap-8">
              <Stat value="10K+" label="Interviews" />
              <div className="w-px h-10 bg-primary-foreground/10" />
              <Stat value="4.9" label="Avg Rating" />
              <div className="w-px h-10 bg-primary-foreground/10" />
              <Stat value="85%" label="Got Hired" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="hidden lg:flex justify-center"
          >
            <div className="relative">
              <div className="w-80 h-80 rounded-full bg-accent/5 border border-accent/10 flex items-center justify-center">
                <div className="w-56 h-56 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <div className="w-32 h-32 rounded-full bg-accent flex items-center justify-center shadow-2xl shadow-accent/40">
                    <Mic className="w-14 h-14 text-accent-foreground" />
                  </div>
                </div>
              </div>
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="absolute -top-4 -right-4 bg-card rounded-2xl p-4 shadow-xl border border-border/50"
              >
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-accent" />
                  <div>
                    <p className="text-xs font-medium text-foreground">Answer Quality</p>
                    <p className="text-lg font-bold text-accent">92/100</p>
                  </div>
                </div>
              </motion.div>
              <motion.div
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 3, repeat: Infinity, delay: 1.5 }}
                className="absolute -bottom-4 -left-8 bg-card rounded-2xl p-4 shadow-xl border border-border/50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <span className="text-emerald-500 text-sm font-bold">A+</span>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground">Communication</p>
                    <p className="text-sm text-muted-foreground">{"Confident & clear"}</p>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }) {
  return (
    <div>
      <p className="font-space text-2xl font-bold text-primary-foreground">{value}</p>
      <p className="text-sm text-primary-foreground/50">{label}</p>
    </div>
  );
}