const CONFIG = {
  // Optional: only needed for live sync (reading new weeks + writing logs
  // back to the sheet). Leave as-is to run in local snapshot mode.
  CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  SPREADSHEET_ID: "1tXrQsx_42LaxTFR975OF-xq868AsDKh3yFkK_sVkI_Y",
  SCOPE: "https://www.googleapis.com/auth/spreadsheets",
  LOG_SHEET_NAME: "Logs",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

const LOCAL_LOG_KEY = "workoutLogs";

const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M5 3.5v9l7-4.5-7-4.5z" fill="currentColor"/></svg>';

const state = {
  live: false, // true once signed in via Google (live sheet read/write)
  accessToken: null,
  monthCache: {}, // live mode: monthName -> { [dayNumber]: text }
  logsByDate: {}, // "YYYY-MM-DD" -> { sections: {idx:true}, notes, rpe }
  selectedDate: null,
  calAnchor: null, // date used for calendar navigation
  view: "week", // "week" | "month"
  tokenClient: null,
};

// ---------- Data access (snapshot by default, live sheet if signed in) ----------

function getDayText(date) {
  if (state.live) {
    const days = state.monthCache[MONTH_NAMES[date.getMonth()]] || {};
    return days[date.getDate()] || "";
  }
  return window.SNAPSHOT?.days?.[dateKey(date)] || "";
}

function getVideo(date) {
  return window.SNAPSHOT?.videos?.[dateKey(date)] || "";
}

// Split a day's text into checkable sections (blank-line separated blocks).
function getSections(date) {
  const text = getDayText(date);
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return { title: lines[0].trim(), detail: lines.slice(1).join("\n").trim() };
    });
}

function getLog(key) {
  const l = state.logsByDate[key];
  return {
    sections: l?.sections ? { ...l.sections } : {},
    notes: l?.notes || "",
    rpe: l?.rpe || null,
  };
}

function allSectionsDone(date) {
  const sections = getSections(date);
  if (!sections.length) return false;
  const log = getLog(dateKey(date));
  return sections.every((_, i) => log.sections[i]);
}

// ---------- Google sign-in (optional upgrade) ----------

function initAuth() {
  if (!window.google?.accounts?.oauth2) return;
  if (CONFIG.CLIENT_ID.startsWith("YOUR_CLIENT_ID")) return;
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPE,
    callback: async (resp) => {
      if (resp.error) { console.error("OAuth error", resp); return; }
      state.accessToken = resp.access_token;
      state.live = true;
      document.getElementById("signInBtn").hidden = true;
      const who = document.getElementById("signedInAs");
      who.hidden = false;
      who.textContent = "live · synced";
      await loadLogsLive();
      await ensureMonthLoaded(MONTH_NAMES[state.selectedDate.getMonth()]);
      render();
    },
  });
}

function signIn() {
  if (CONFIG.CLIENT_ID.startsWith("YOUR_CLIENT_ID")) {
    alert(
      "Live sync needs a Google OAuth Client ID first.\n\n" +
      "See README.md for the ~10-minute one-time setup. Until then the app " +
      "runs on the built-in snapshot of your workouts, saving check-offs to " +
      "this browser."
    );
    return;
  }
  state.tokenClient.requestAccessToken();
}

// ---------- Sheets API (live mode only) ----------

async function sheetsGet(path, params) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${state.accessToken}` } });
  if (!res.ok) throw new Error(`Sheets GET ${path} failed: ${res.status}`);
  return res.json();
}

async function sheetsPost(path, body) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheets POST ${path} failed: ${res.status}`);
  return res.json();
}

async function ensureMonthLoaded(monthName) {
  if (state.monthCache[monthName]) return;
  const data = await sheetsGet("", {
    ranges: monthName,
    fields: "sheets.data.rowData.values(formattedValue,note)",
  });
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData || [];
  const rows = rowData.map((row) =>
    (row.values || []).map((cell) => ({ value: cell.formattedValue || "", note: cell.note || "" }))
  );
  state.monthCache[monthName] = parseMonthRows(rows);
}

const DAY_COLS = [1, 2, 3, 4, 5, 6, 7];

function isDayNumberRow(row) {
  if (!row) return false;
  let numericCount = 0, hasLongText = false;
  for (const col of DAY_COLS) {
    const v = (row[col]?.value || "").trim();
    if (!v) continue;
    if (/^\d{1,2}(\.0)?$/.test(v)) numericCount++;
    else if (v.length > 3) hasLongText = true;
  }
  return numericCount >= 2 && !hasLongText;
}

function cellText(cell) {
  if (!cell) return "";
  return [cell.value, cell.note].filter(Boolean).join("\n").trim();
}

function parseMonthRows(rows) {
  const days = {};
  for (let i = 0; i < rows.length; i++) {
    if (!isDayNumberRow(rows[i])) continue;
    const row = rows[i];
    const next = rows[i + 1];
    const nextIsContent = next && !isDayNumberRow(next);
    for (const col of DAY_COLS) {
      const numStr = (row[col]?.value || "").trim();
      const day = parseInt(numStr, 10);
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      const parts = [];
      const numLeftover = cellText(row[col]);
      if (numLeftover && numLeftover.length >= 4) parts.push(numLeftover);
      if (nextIsContent) parts.push(cellText(next[col]));
      const text = parts.filter(Boolean).join("\n\n").trim();
      if (text) days[day] = text;
    }
    if (nextIsContent) i++;
  }
  return days;
}

// ---------- Logs ----------

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadLogsLocal() {
  try {
    state.logsByDate = JSON.parse(localStorage.getItem(LOCAL_LOG_KEY)) || {};
  } catch {
    state.logsByDate = {};
  }
}

async function loadLogsLive() {
  try {
    const data = await sheetsGet(`/values/${CONFIG.LOG_SHEET_NAME}!A2:F`, {});
    for (const [date, , notes, , sectionsJson, rpe] of data.values || []) {
      if (!date) continue;
      let sections = {};
      try { sections = JSON.parse(sectionsJson || "{}"); } catch { /* ignore */ }
      state.logsByDate[date] = { sections, notes: notes || "", rpe: rpe ? Number(rpe) : null };
    }
  } catch {
    /* Logs tab may not exist yet */
  }
}

async function ensureLogsSheetExists() {
  const meta = await sheetsGet("", { fields: "sheets.properties.title" });
  if ((meta.sheets || []).some((s) => s.properties.title === CONFIG.LOG_SHEET_NAME)) return;
  await sheetsPost(":batchUpdate", {
    requests: [{ addSheet: { properties: { title: CONFIG.LOG_SHEET_NAME } } }],
  });
  await sheetsPost(`/values/${CONFIG.LOG_SHEET_NAME}!A1:F1:append?valueInputOption=RAW`, {
    values: [["Date", "Completed", "Notes", "Timestamp", "SectionState", "RPE"]],
  });
}

async function persist(date) {
  const key = dateKey(date);
  const log = getLog(key);
  const status = document.getElementById("saveStatus");
  status.textContent = "Saving…";
  try {
    state.logsByDate[key] = log;
    if (state.live) {
      await ensureLogsSheetExists();
      await sheetsPost(`/values/${CONFIG.LOG_SHEET_NAME}!A:F:append?valueInputOption=USER_ENTERED`, {
        values: [[key, allSectionsDone(date) ? "TRUE" : "FALSE", log.notes, new Date().toISOString(), JSON.stringify(log.sections), log.rpe ?? ""]],
      });
    } else {
      localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(state.logsByDate));
    }
    status.textContent = state.live ? "Saved to sheet." : "Saved.";
    renderCalendar();
  } catch (err) {
    console.error(err);
    status.textContent = "Save failed — try again.";
  }
}

// ---------- Calendar (week + month views) ----------

function makeDayCell(d, compact) {
  const el = document.createElement("div");
  el.className = "cal-day" + (compact ? " compact" : "");
  if (dateKey(d) === dateKey(state.selectedDate)) el.classList.add("selected");
  if (allSectionsDone(d)) el.classList.add("completed");
  if (getDayText(d)) el.classList.add("has-workout");
  if (compact) {
    el.innerHTML = `<div class="wd">${d.toLocaleDateString(undefined, { weekday: "short" })}</div><div class="dn">${d.getDate()}</div>`;
  } else {
    el.innerHTML = `<div class="dn">${d.getDate()}</div>`;
  }
  el.addEventListener("click", () => selectDate(d));
  return el;
}

function renderCalendar() {
  const body = document.getElementById("calBody");
  const title = document.getElementById("calTitle");
  body.innerHTML = "";
  document.getElementById("viewWeek").classList.toggle("active", state.view === "week");
  document.getElementById("viewMonth").classList.toggle("active", state.view === "month");

  const anchor = state.calAnchor;
  if (state.view === "week") {
    title.textContent = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const strip = document.createElement("div");
    strip.className = "week-strip";
    const base = new Date(anchor);
    base.setDate(base.getDate() - base.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      strip.appendChild(makeDayCell(d, true));
    }
    body.appendChild(strip);
  } else {
    title.textContent = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const grid = document.createElement("div");
    grid.className = "month-grid";
    DOW.forEach((d) => {
      const h = document.createElement("div");
      h.className = "dow";
      h.textContent = d;
      grid.appendChild(h);
    });
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const first = new Date(y, m, 1);
    const lead = first.getDay();
    for (let i = 0; i < lead; i++) {
      const blank = document.createElement("div");
      blank.className = "cal-day blank";
      grid.appendChild(blank);
    }
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      grid.appendChild(makeDayCell(new Date(y, m, day), false));
    }
    body.appendChild(grid);
  }
}

function shiftCalendar(dir) {
  const a = new Date(state.calAnchor);
  if (state.view === "week") a.setDate(a.getDate() + dir * 7);
  else a.setMonth(a.getMonth() + dir);
  state.calAnchor = a;
  renderCalendar();
}

function setView(view) {
  state.view = view;
  renderCalendar();
}

// ---------- Day card ----------

async function selectDate(date) {
  state.selectedDate = date;
  state.calAnchor = new Date(date);
  if (state.live) await ensureMonthLoaded(MONTH_NAMES[date.getMonth()]);
  render();
}

function toggleSection(index) {
  const key = dateKey(state.selectedDate);
  const log = getLog(key);
  log.sections[index] = !log.sections[index];
  if (!log.sections[index]) delete log.sections[index];
  state.logsByDate[key] = log;
  persist(state.selectedDate);
  render();
}

function setRpe(value) {
  const key = dateKey(state.selectedDate);
  const log = getLog(key);
  log.rpe = log.rpe === value ? null : value; // tap again to clear
  state.logsByDate[key] = log;
  persist(state.selectedDate);
  render();
}

function render() {
  const d = state.selectedDate;
  const key = dateKey(d);
  const sections = getSections(d);
  const log = getLog(key);
  const video = getVideo(d);

  document.getElementById("dayNumber").textContent = d.getDate();
  document.getElementById("dayWeekday").textContent = d.toLocaleDateString(undefined, { weekday: "long" });
  document.getElementById("dayMonthYear").textContent = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const doneCount = sections.filter((_, i) => log.sections[i]).length;
  const badge = document.getElementById("progressBadge");
  if (sections.length) {
    badge.hidden = false;
    badge.textContent = doneCount === sections.length ? "All done" : `${doneCount} / ${sections.length}`;
    badge.classList.toggle("all-done", doneCount === sections.length);
  } else {
    badge.hidden = true;
  }

  const container = document.getElementById("sections");
  container.innerHTML = "";
  if (!sections.length) {
    const p = document.createElement("p");
    p.className = "day-empty";
    p.textContent = "Nothing programmed for this day.";
    container.appendChild(p);
  } else {
    sections.forEach((sec, i) => {
      const done = !!log.sections[i];
      const el = document.createElement("div");
      el.className = "section" + (done ? " done" : "");
      el.innerHTML =
        `<div class="section-check">${CHECK_SVG}</div>` +
        `<div class="section-body">` +
        `<div class="section-title"></div>` +
        `<div class="section-detail"></div>` +
        `</div>`;
      el.querySelector(".section-title").textContent = sec.title;
      el.querySelector(".section-detail").textContent = sec.detail;
      // Attach the day's demo video to its first section (that's where the
      // sheet's link lives — the featured / warm-up exercise).
      if (i === 0 && video) {
        const play = document.createElement("a");
        play.className = "play-btn";
        play.href = video;
        play.target = "_blank";
        play.rel = "noopener";
        play.innerHTML = `${PLAY_SVG}<span>Watch</span>`;
        play.addEventListener("click", (e) => e.stopPropagation());
        el.querySelector(".section-body").appendChild(play);
      }
      el.addEventListener("click", () => toggleSection(i));
      container.appendChild(el);
    });
  }

  // Effort / RPE rating
  const effortBlock = document.getElementById("effortBlock");
  effortBlock.hidden = !sections.length;
  if (sections.length) {
    const rpeRow = document.getElementById("rpeRow");
    rpeRow.innerHTML = "";
    for (let n = 1; n <= 10; n++) {
      const b = document.createElement("button");
      b.className = "rpe-btn" + (log.rpe === n ? " active" : "");
      b.textContent = n;
      b.addEventListener("click", () => setRpe(n));
      rpeRow.appendChild(b);
    }
    const cap = document.getElementById("rpeCaption");
    cap.textContent = log.rpe
      ? `Rated ${log.rpe}/10 — ${rpeLabel(log.rpe)}`
      : "Tap to rate your effort (RPE 1–10)";
  }

  document.getElementById("notesInput").value = log.notes;
  document.getElementById("saveStatus").textContent = "";
  renderCalendar();
}

function rpeLabel(n) {
  if (n <= 2) return "very easy";
  if (n <= 4) return "easy";
  if (n <= 6) return "moderate";
  if (n === 7) return "hard";
  if (n === 8) return "very hard";
  if (n === 9) return "near max";
  return "max effort";
}

// ---------- Boot ----------

function pickInitialDate() {
  const today = new Date();
  if (getDayText(today)) return today;
  const keys = Object.keys(window.SNAPSHOT?.days || {}).sort();
  if (keys.length) {
    const [y, m, day] = keys[keys.length - 1].split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  return today;
}

document.getElementById("signInBtn").addEventListener("click", signIn);
document.getElementById("saveBtn").addEventListener("click", () => {
  const key = dateKey(state.selectedDate);
  const log = getLog(key);
  log.notes = document.getElementById("notesInput").value;
  state.logsByDate[key] = log;
  persist(state.selectedDate);
});
document.getElementById("calPrev").addEventListener("click", () => shiftCalendar(-1));
document.getElementById("calNext").addEventListener("click", () => shiftCalendar(1));
document.getElementById("viewWeek").addEventListener("click", () => setView("week"));
document.getElementById("viewMonth").addEventListener("click", () => setView("month"));

// Snapshot mode is always ready immediately — no sign-in required to view.
loadLogsLocal();
state.selectedDate = pickInitialDate();
state.calAnchor = new Date(state.selectedDate);
document.getElementById("signedOutView").hidden = true;
document.getElementById("appView").hidden = false;
render();

if (window.google?.accounts?.oauth2) initAuth();
else window.addEventListener("load", initAuth);
