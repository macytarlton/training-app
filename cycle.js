// Cycle tracking — computes menstrual-cycle phase for any date from logged
// period start dates, and maps each phase to energy + training guidance.
//
// This is general, evidence-informed guidance, not medical advice. Every
// body is different; it's a prompt to listen to yours, not a rule.
//
// Personal period dates are stored in this browser (localStorage). The
// seed default below (last period start) is committed with the app.
window.Cycle = (function () {
  const KEY = "cycleConfig";
  const DEFAULT = {
    periodStarts: ["2026-07-28"], // most recent known period start(s)
    cycleLength: 28,
    periodLength: 5,
  };

  const PHASES = {
    menstrual: {
      key: "menstrual",
      label: "Menstrual",
      color: "#d76a86",
      energy: "Lower, especially days 1–2",
      note: "Period. Energy can dip early — scale intensity to how you feel, and prioritize sleep, iron and recovery.",
    },
    follicular: {
      key: "follicular",
      label: "Follicular",
      color: "#2f9f83",
      energy: "Rising / high",
      note: "Estrogen climbing — a great window for hard sessions, heavy lifting and PR attempts.",
    },
    ovulation: {
      key: "ovulation",
      label: "Ovulation",
      color: "#e0913c",
      energy: "Peak power",
      note: "Peak strength — but ligaments are laxer now, so warm up thoroughly and stay sharp on landings and cuts.",
    },
    luteal: {
      key: "luteal",
      label: "Luteal",
      color: "#6b83c9",
      energy: "Moderate",
      note: "Still solid work. Core temp runs higher, so hydrate well and keep recovery a priority.",
    },
    late_luteal: {
      key: "late_luteal",
      label: "Late luteal (PMS)",
      color: "#9a6bb0",
      energy: "Lower, effort feels higher",
      note: "Fatigue and perceived effort rise — a deload-friendly stretch. Don't measure yourself against your best weeks.",
    },
  };

  function load() {
    try {
      return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
    } catch {
      return { ...DEFAULT };
    }
  }
  function save(cfg) {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  }
  function dayNum(s) {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }

  function phaseFor(day, L, P) {
    const ov = Math.max(P + 3, L - 14); // ovulation ≈ 14 days before next period
    if (day <= P) return PHASES.menstrual;
    if (day >= ov - 1 && day <= ov + 1) return PHASES.ovulation;
    if (day < ov - 1) return PHASES.follicular;
    if (day >= L - 3) return PHASES.late_luteal;
    return PHASES.luteal;
  }

  // Returns { day, L, isPredicted, ...phase } for a "YYYY-MM-DD" date, or null.
  function forDate(dateStr, cfg) {
    cfg = cfg || load();
    const starts = (cfg.periodStarts || []).slice().sort();
    if (!starts.length) return null;
    const L = cfg.cycleLength || 28;
    const P = cfg.periodLength || 5;
    const t = dayNum(dateStr);
    // Anchor to the most recent logged start on or before the date. We do NOT
    // project backward before the first logged period — guessing past cycles
    // we have no data for is what made periods appear "too often". Cycle info
    // shows from the earliest logged start forward (real + predicted ahead).
    let anchor = null;
    for (const s of starts) if (dayNum(s) <= t) anchor = s;
    if (anchor === null) return null;
    const diff = t - dayNum(anchor);
    const day = (((diff % L) + L) % L) + 1;
    return { day, L, phase: phaseFor(day, L, P) };
  }

  function addStart(dateStr) {
    const cfg = load();
    if (!cfg.periodStarts.includes(dateStr)) {
      cfg.periodStarts.push(dateStr);
      cfg.periodStarts.sort();
    }
    save(cfg);
    return cfg;
  }
  function removeStart(dateStr) {
    const cfg = load();
    cfg.periodStarts = cfg.periodStarts.filter((s) => s !== dateStr);
    save(cfg);
    return cfg;
  }
  function setLengths(cycleLength, periodLength) {
    const cfg = load();
    if (cycleLength) cfg.cycleLength = cycleLength;
    if (periodLength) cfg.periodLength = periodLength;
    save(cfg);
    return cfg;
  }

  return { load, save, forDate, addStart, removeStart, setLengths, PHASES };
})();
