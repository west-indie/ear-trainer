import { Link } from "react-router-dom";
import { getDashboardSummary, resetProgress } from "../store/progressStore";
import { clearAnalytics, getAnalyticsSummary } from "../store/analyticsStore";

function masteryBar(value: number) {
  return (
    <div style={{ height: 10, borderRadius: 999, background: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.round(value * 100)}%`, background: "linear-gradient(90deg,#0b8f5a,#2ab37a)" }} />
    </div>
  );
}

export default function ProgressPage() {
  const summary = getDashboardSummary();
  const analytics = getAnalyticsSummary();
  const skillLabel: Record<"intervals" | "degrees" | "chords" | "timing" | "phrases", string> = {
    intervals: "Intervals",
    degrees: "Degrees",
    chords: "Chords",
    timing: "Timing",
    phrases: "Phrases",
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Progress</h2>
      <div style={{ display: "grid", gap: 6 }}>
        <div>Total attempts: <b>{summary.totals.attempts}</b></div>
        <div>Accuracy: <b>{(summary.totals.accuracy * 100).toFixed(1)}%</b></div>
        <div>Current streak: <b>{summary.totals.streak}</b> (best {summary.totals.bestStreak})</div>
      </div>

      <div style={{ display: "grid", gap: 10, padding: 12, borderRadius: 12, background: "white", border: "1px solid rgba(0,0,0,0.12)" }}>
        {summary.skills.map((skill) => (
          <div key={skill.skill} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <div style={{ fontWeight: 700 }}>{skillLabel[skill.skill]}</div>
              <div>{Math.round(skill.mastery * 100)}%</div>
            </div>
            {masteryBar(skill.mastery)}
            <div style={{ opacity: 0.7, fontSize: 12 }}>
              Attempts {skill.attempts} | Due {skill.dueCount} | Weak {skill.weakCount}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Flow diagnostics</div>
        <div>Total events: <b>{analytics.totalEvents}</b></div>
        <div>Page views: <b>{analytics.pageViews}</b></div>
        <div>Finished runs: <b>{analytics.completedSessions}</b></div>
        <div>Abandoned runs: <b>{analytics.abandonedSessions}</b></div>
        <div>Completion rate: <b>{(analytics.completionRate * 100).toFixed(1)}%</b></div>
        <div className="subtle" style={{ fontSize: 13 }}>
          Top drop-off routes: {analytics.dropOffRoutes.length > 0 ? analytics.dropOffRoutes.map((route) => `${route.route} (${route.count})`).join(", ") : "none yet"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link to="/practice?review=due" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)", color: "inherit", textDecoration: "none", background: "white" }}>
          Start due session ({summary.reviewCounts.due})
        </Link>
        <Link to="/practice?review=weak" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)", color: "inherit", textDecoration: "none", background: "white" }}>
          Start focus session ({summary.reviewCounts.weak})
        </Link>
        <div style={{ opacity: 0.7, fontSize: 12, alignSelf: "center" }}>
          Launches a targeted run using your recent performance and scheduling data.
        </div>
      </div>

      <button onClick={() => { resetProgress(); location.reload(); }} style={{ width: 180 }}>
        Reset progress
      </button>
      <button onClick={() => { clearAnalytics(); location.reload(); }} style={{ width: 180 }}>
        Reset diagnostics
      </button>
    </div>
  );
}
