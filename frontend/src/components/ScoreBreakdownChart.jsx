import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell
} from "recharts";

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-lg">
        <p className="text-sm font-semibold">{payload[0].value}<span className="text-muted-foreground font-normal">/100</span></p>
      </div>
    );
  }
  return null;
};

export function ScoreRadarChart({ questions }) {
  if (!questions?.length) return null;

  const data = [
    { subject: "Answer Quality", score: Math.round(questions.reduce((s, q) => s + (q.score_answer_quality || 0), 0) / questions.length) },
    { subject: "English Clarity", score: Math.round(questions.reduce((s, q) => s + (q.score_english_clarity || 0), 0) / questions.length) },
    { subject: "Communication", score: Math.round(questions.reduce((s, q) => s + (q.score_communication || 0), 0) / questions.length) },
  ];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12, fontWeight: 500 }}
        />
        <Radar
          name="Score"
          dataKey="score"
          stroke="hsl(var(--accent))"
          fill="hsl(var(--accent))"
          fillOpacity={0.15}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function ScoreProgressionChart({ questions }) {
  if (!questions?.length) return null;

  const data = questions.map((q, i) => ({
    name: `Q${i + 1}`,
    quality: q.score_answer_quality,
    clarity: q.score_english_clarity,
    communication: q.score_communication,
    avg: Math.round((q.score_answer_quality + q.score_english_clarity + q.score_communication) / 3),
  }));

  const getBarColor = (value) => {
    if (value >= 80) return "#22c55e";
    if (value >= 60) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barGap={4} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))", radius: 6 }} />
        <Bar dataKey="quality" name="Quality" radius={[6, 6, 0, 0]} maxBarSize={28}>
          {data.map((entry, i) => (
            <Cell key={i} fill="#6366f1" fillOpacity={0.8} />
          ))}
        </Bar>
        <Bar dataKey="clarity" name="Clarity" radius={[6, 6, 0, 0]} maxBarSize={28}>
          {data.map((entry, i) => (
            <Cell key={i} fill="hsl(var(--accent))" fillOpacity={0.8} />
          ))}
        </Bar>
        <Bar dataKey="communication" name="Communication" radius={[6, 6, 0, 0]} maxBarSize={28}>
          {data.map((entry, i) => (
            <Cell key={i} fill="#22c55e" fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ScoreLegend() {
  const items = [
    { color: "#6366f1", label: "Answer Quality" },
    { color: "hsl(var(--accent))", label: "English Clarity" },
    { color: "#22c55e", label: "Communication" },
  ];
  return (
    <div className="flex items-center justify-center gap-5 mt-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
          <span className="text-xs text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}