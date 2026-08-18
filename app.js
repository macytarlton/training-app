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

const LOCAL_LOG_KEY = "workoutLogs";

const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const state = {
  live: false, // true once signed in via Google (live sheet read/write)
  accessToken: null,
  monthCache: {}, // live mode: monthName -> { [dayNumber]: text }
  logsByDate: {}, // "YYYY-MM-DD" -> { sections: {idx:true}, notes }
  selectedDate: null,
  tokenClient: null,
};

// ---------- Data access (snapshot by default, live sheet if signed in) ----------

function getDayText(date) {
  if (state.live) {
    const days = state.monthCache[MONTH_NAMES[date.getMonth()]] || {};
    return days[date.getDate()] || "";
  }
  const snap = window.SNAPSHOT?.days || {};
  return snap[dateKey(date)] || "";
}

// Split a day's text into checkable sections (blank-line separated blocks).
// Each section's first line becomes its title, the rest its detail.
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
  return { sections: l?.sections ? { ...l.sections } : {}, notes: l?.notes || "" };
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

// ---------- Live grid parsing (mirrors the snapshot generator) ----------

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
    const data = await sheetsGet(`/values/${CONFIG.LOG_SHEET_NAME}!A2:E`, {});
    for (const [date, , notes, , sectionsJson] of data.values || []) {
      if (!date) continue;
      let sections = {};
      try { sections = JSON.parse(sectionsJson || "{}"); } catch { /* ignore */ }
      state.logsByDate[date] = { sections, notes: notes || "" };
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
  await sheetsPost(`/values/${CONFIG.LOG_SHEET_NAME}!A1:E1:append?valueInputOption=RAW`, {
    values: [["Date", "Completed", "Notes", "Timestamp", "SectionState"]],
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
      await sheetsPost(`/values/${CONFIG.LOG_SHEET_NAME}!A:E:append?valueInputOption=USER_ENTERED`, {
        values: [[key, allSectionsDone(date) ? "TRUE" : "FALSE", log.notes, new Date().toISOString(), JSON.stringify(log.sections)]],
      });
    } else {
      localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(state.logsByDate));
    }
    status.textContent = state.live ? "Saved to sheet." : "Saved.";
    renderWeekStrip();
  } catch (err) {
    console.error(err);
    status.textContent = "Save failed — try again.";
  }
}

// ---------- Rendering ----------

async function selectDate(date) {
  state.selectedDate = date;
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

function render() {
  const d = state.selectedDate;
  const key = dateKey(d);
  const sections = getSections(d);
  const log = getLog(key);

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
      el.addEventListener("click", () => toggleSection(i));
      container.appendChild(el);
    });
  }

  document.getElementById("notesInput").value = log.notes;
  document.getElementById("saveStatus").textContent = "";
  renderWeekStrip();
}

function renderWeekStrip() {
  const strip = document.getElementById("weekStrip");
  strip.innerHTML = "";
  const base = new Date(state.selectedDate);
  base.setDate(base.getDate() - base.getDay());
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const el = document.createElement("div");
    el.className = "week-strip-day";
    if (dateKey(d) === dateKey(state.selectedDate)) el.classList.add("selected");
    if (allSectionsDone(d)) el.classList.add("completed");
    if (getDayText(d)) el.classList.add("has-workout");
    el.innerHTML = `<div class="wd">${d.toLocaleDateString(undefined, { weekday: "short" })}</div><div class="dn">${d.getDate()}</div>`;
    el.addEventListener("click", () => selectDate(d));
    strip.appendChild(el);
  }
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

// Snapshot mode is always ready immediately — no sign-in required to view.
loadLogsLocal();
state.selectedDate = pickInitialDate();
document.getElementById("signedOutView").hidden = true;
document.getElementById("appView").hidden = false;
render();

if (window.google?.accounts?.oauth2) initAuth();
else window.addEventListener("load", initAuth);
