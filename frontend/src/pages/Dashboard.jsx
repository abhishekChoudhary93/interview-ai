import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mic, ArrowRight, Clock, TrendingUp, BarChart3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listInterviews } from '@/api/interviews';
import { useAuth } from '@/lib/AuthContext';
import ScoreGauge from "../components/ScoreGauge";

export default function Dashboard() {
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    listInterviews({ status: 'completed', sort: '-created_date', limit: 20 })
      .then(setInterviews)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  const avgScore = interviews.length
    ? Math.round(interviews.reduce((s, i) => s + (i.overall_score || 0), 0) / interviews.length)
    : 0;

  const totalTime = interviews.reduce((s, i) => s + (i.duration_seconds || 0), 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Welcome */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="font-space text-2xl lg:text-3xl font-bold">
            Welcome back{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-muted-foreground mt-1">Track your interview practice and improvement.</p>
        </div>
        <Link to="/setup">
          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 rounded-xl h-12 px-6 font-semibold">
            <Plus className="w-4 h-4" /> New Interview
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard icon={<BarChart3 className="w-5 h-5" />} label="Interviews" value={interviews.length} />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Avg Score" value={avgScore ? `${avgScore}/100` : "—"} />
        <StatCard icon={<Clock className="w-5 h-5" />} label="Total Practice" value={`${Math.round(totalTime / 60)}m`} />
        <StatCard
          icon={<Mic className="w-5 h-5" />}
          label="Best Score"
          value={interviews.length ? `${Math.max(...interviews.map(i => i.overall_score || 0))}/100` : "—"}
        />
      </div>

      {/* Recent Interviews */}
      <div>
        <h2 className="font-space text-lg font-semibold mb-4">Recent Interviews</h2>
        {interviews.length === 0 ? (
          <div className="bg-card rounded-3xl border border-border/50 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
              <Mic className="w-8 h-8 text-accent" />
            </div>
            <h3 className="font-space font-semibold text-lg mb-2">No interviews yet</h3>
            <p className="text-muted-foreground mb-6">Start your first mock interview to begin tracking your progress.</p>
            <Link to="/setup">
              <Button className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 rounded-xl">
                Start Your First Interview <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {interviews.map((interview, i) => (
              <motion.div
                key={interview.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <button
                  onClick={() => navigate(`/report?id=${interview.id}`)}
                  className="w-full bg-card rounded-2xl border border-border/50 p-5 flex items-center gap-5 hover:border-accent/20 hover:shadow-lg hover:shadow-accent/5 transition-all duration-200 text-left"
                >
                  <ScoreGauge score={interview.overall_score} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{interview.role_title}</p>
                    <p className="text-sm text-muted-foreground truncate">{interview.company}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="capitalize">{interview.interview_type}</span>
                      <span>•</span>
                      <span>{new Date(interview.created_date).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="bg-card rounded-2xl border border-border/50 p-5">
      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent mb-3">
        {icon}
      </div>
      <p className="font-space text-2xl font-bold">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}