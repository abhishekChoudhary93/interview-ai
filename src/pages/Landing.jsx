import HeroSection from "../components/landing/HeroSection";
import HowItWorks from "../components/landing/HowItWorks";
import Features from "../components/landing/Features";
import CTASection from "../components/landing/CTASection";
import AnimatedDemo from "../components/landing/AnimatedDemo";
import { Link } from "react-router-dom";
import { Mic } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="absolute top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center">
                <Mic className="w-5 h-5 text-accent-foreground" />
              </div>
              <span className="font-space font-bold text-lg text-primary-foreground tracking-tight">InterviewAI</span>
            </Link>
            <nav className="flex items-center gap-6">
              <a href="#how-it-works" className="text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">How It Works</a>
              <Link to="/setup" className="text-sm font-semibold text-accent hover:text-accent/80 transition-colors">
                Start Interview →
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <HeroSection />
      <HowItWorks />
      <AnimatedDemo />
      <Features />
      <CTASection />

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <Mic className="w-4 h-4 text-accent-foreground" />
            </div>
            <span className="font-space font-bold text-sm">InterviewAI</span>
          </div>
          <p className="text-sm text-muted-foreground">© 2026 InterviewAI. Practice anywhere, ace everywhere.</p>
        </div>
      </footer>
    </div>
  );
}