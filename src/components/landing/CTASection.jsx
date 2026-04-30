import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CTASection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative overflow-hidden rounded-3xl bg-primary p-12 lg:p-20 text-center"
        >
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-96 h-96 bg-accent rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-72 h-72 bg-blue-500 rounded-full blur-3xl" />
          </div>
          <div className="relative">
            <h2 className="font-space text-3xl sm:text-4xl lg:text-5xl font-bold text-primary-foreground tracking-tight">
              Stop guessing.<br />Start practicing.
            </h2>
            <p className="mt-6 text-lg text-primary-foreground/60 max-w-xl mx-auto">
              Join thousands of job seekers who landed their dream roles by practicing with InterviewAI.
              Your next interview is closer than you think.
            </p>
            <Link to="/setup" className="inline-block mt-10">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold px-10 h-14 text-base rounded-2xl gap-2 shadow-lg shadow-accent/25">
                Start Your Mock Interview
                <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}