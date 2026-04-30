import { motion } from "framer-motion";

export default function ScoreGauge({ score, label, size = "md", color = "accent" }) {
  const sizes = {
    sm: { w: 80, stroke: 6, text: "text-xl", label: "text-xs" },
    md: { w: 120, stroke: 8, text: "text-3xl", label: "text-sm" },
    lg: { w: 160, stroke: 10, text: "text-4xl", label: "text-base" },
  };
  const s = sizes[size];
  const radius = (s.w - s.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = ((score || 0) / 100) * circumference;

  const getColor = (score) => {
    if (score >= 80) return "text-emerald-500";
    if (score >= 60) return "text-amber-500";
    return "text-red-500";
  };

  const getStrokeColor = (score) => {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: s.w, height: s.w }}>
        <svg width={s.w} height={s.w} className="-rotate-90">
          <circle
            cx={s.w / 2}
            cy={s.w / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={s.stroke}
          />
          <motion.circle
            cx={s.w / 2}
            cy={s.w / 2}
            r={radius}
            fill="none"
            stroke={getStrokeColor(score)}
            strokeWidth={s.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - progress }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-space font-bold ${s.text} ${getColor(score)}`}>
            {score || 0}
          </span>
        </div>
      </div>
      {label && <p className={`${s.label} text-muted-foreground font-medium text-center`}>{label}</p>}
    </div>
  );
}