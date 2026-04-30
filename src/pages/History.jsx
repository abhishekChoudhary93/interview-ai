import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Filter, ArrowRight, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";
import ScoreGauge from "../components/ScoreGauge";

export default function History() {
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    base44.entities.Interview.filter({ status: "completed" }, "-created_date", 50).then(data => {
      setInterviews(data);
      setLoading(false);
    });
  }, []);

  const filtered = interviews.filter(i =>
    i.role_title?.toLowerCase().includes(search.toLowerCase()) ||
    i.company?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (confirm("Delete this interview?")) {
      await base44.entities.Interview.delete(id);
      setInterviews(prev => prev.filter(i => i.id !== id));
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="font-space text-2xl font-bold mb-6">Interview History</h1>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by role or company..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-11 h-12 rounded-xl bg-card"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No interviews found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((interview, i) => (
            <motion.div
              key={interview.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <div
                onClick={() => navigate(`/report?id=${interview.id}`)}
                className="bg-card rounded-2xl border border-border/50 p-5 flex items-center gap-5 hover:border-accent/20 hover:shadow-lg transition-all cursor-pointer group"
              >
                <ScoreGauge score={interview.overall_score} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{interview.role_title}</p>
                  <p className="text-sm text-muted-foreground">{interview.company}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <span className="capitalize">{interview.interview_type}</span>
                    <span>•</span>
                    <span className="capitalize">{interview.experience_level}</span>
                    <span>•</span>
                    <span>{new Date(interview.created_date).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleDelete(e, interview.id)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}