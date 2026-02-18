import {
  login,
  getToken,
  logout,
  decodeJwtPayload,
  getUserIdFromToken,
} from "./lib/auth.js";
import { gql, GraphQLAuthError } from "./lib/graphql.js";
import {
  filterByLastDays,
  groupXpByPeriod,
  toCumulative,
  formatXp,
  auditTotals,
  passFailCounts,
} from "./lib/stats.js";
import { computeAttemptsPF } from "./lib/projectsPF.js";
import { lineChartSvg, donutChartSvg } from "./lib/charts.js";

let cached = null;
let cachedAt = 0;
let inflight = null;

// =======================
// BH-MODULE ONLY SCOPE
// =======================

const BH_SEG_RE = /^bh[-_]?module$/i;
const MODULE_NAME = "BH-MODULE";
const MODULE_GQL_ILIKE = "%bh%module%";
const NON_PROJECT_RE = /piscine|checkpoint|onboarding/i;

function pathSegments(path) {
  return String(path || "").split("/").filter(Boolean);
}
function programSeg(path) {
  const parts = pathSegments(path);
  return parts[1] || "";
}
function restAfterProgram(path) {
  const parts = pathSegments(path);
  return parts.slice(2).join("/").toLowerCase();
}

function isBhModulePath(path) {
  return BH_SEG_RE.test(programSeg(path));
}

// ✅ exclusion rules to match XP board behavior for BH-only:
// - exclude onboarding + checkpoint
// - exclude ANYTHING containing "piscine" under BH-MODULE (piscine-js + its quests/nodes)
function isExcludedBhXpPath(path) {
  const rest = restAfterProgram(path); // after /user/bh-module/
  if (rest.includes("onboarding")) return true;

  // ✅ allow ONLY the top-level "piscine-js" project, but exclude its inner quests/paths
  if (rest.startsWith("piscine-js")) {
    // allow: /user/bh-module/piscine-js  (exact)
    // exclude: /user/bh-module/piscine-js/quests/... or anything deeper
    return rest.includes("/") ? true : false;
  }

  // exclude any other piscine stuff
  if (rest.includes("piscine")) return true;

  return false;
}

// For pass/fail: count only real BH projects (top-level after program)
function isBhModuleProject(path) {
  const parts = pathSegments(path);
  if (!BH_SEG_RE.test(parts[1] || "")) return false;
  if (parts.length !== 3) return false; // must be /user/bh-module/<project>
  if (NON_PROJECT_RE.test(parts[2] || "")) return false;
  return true;
}

function calcXpTotals(txList) {
  let earned = 0;
  let removed = 0; // absolute sum of negatives
  for (const t of txList) {
    const a = Number(t.amount || 0);
    if (a >= 0) earned += a;
    else removed += Math.abs(a);
  }
  return {
    earned,
    removed,
    net: earned - removed, // ✅ this should align with "Total XP" style numbers like 571
  };
}

// =======================
// UI state
// =======================

const uiState = {
  rangeDays: 0,
  period: "day",
};

function initUiState() {
  try {
    const range = sessionStorage.getItem("rangeDays");
    const period = sessionStorage.getItem("period");
    if (range) uiState.rangeDays = Number(range);
    if (period) uiState.period = period;
  } catch {}
}

function persistUiState() {
  try {
    sessionStorage.setItem("rangeDays", String(uiState.rangeDays));
    sessionStorage.setItem("period", uiState.period);
  } catch {}
}

// =======================
// Rendering
// =======================

function render() {
  const token = getToken();
  if (!token) renderLogin();
  else renderAuthed();
}

function renderLogin() {
  document.querySelector("#app").innerHTML = `
    <div class="authPage">
      <div class="authCard">
        <div class="brand">
          <div class="logo" aria-hidden="true"></div>
          <div>
            <h1>GraphQL Profile</h1>
            <p class="muted">Sign in to load your personal dashboard.</p>
          </div>
        </div>

        <form id="loginForm" class="form">
          <label>
            Username or Email
            <input id="login" type="text" placeholder="username or email" autocomplete="username" required />
          </label>

          <label>
            Password
            <div class="passwordRow">
              <input id="password" type="password" placeholder="••••••••" autocomplete="current-password" required />
              <button id="togglePw" type="button" class="btnGhost" aria-label="Show password">Show</button>
            </div>
          </label>

          <button id="submitBtn" type="submit" class="btnPrimary">Sign in</button>
          <p class="hint muted">Works with <b>username:password</b> or <b>email:password</b>.</p>
          <p id="msg" class="msg" role="status" aria-live="polite"></p>
        </form>
      </div>
    </div>
  `;

  const form = document.querySelector("#loginForm");
  const msg = document.querySelector("#msg");

  const toggle = document.querySelector("#togglePw");
  toggle.addEventListener("click", () => {
    const pw = document.querySelector("#password");
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const loginValue = document.querySelector("#login").value.trim();
    const password = document.querySelector("#password").value;

    const submitBtn = document.querySelector("#submitBtn");
    submitBtn.disabled = true;
    msg.textContent = "Signing in…";
    msg.className = "msg";

    try {
      await login(loginValue, password);
      msg.textContent = "Success. Loading your profile…";
      msg.className = "msg ok";
      location.hash = "#overview";
      render();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "msg err";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function renderAuthed() {
  const token = getToken();
  const payload = decodeJwtPayload(token);
  const userId = getUserIdFromToken(token);

  document.querySelector("#app").innerHTML = `
    <div class="page">
      <header class="header">
        <div>
          <h1 class="pageTitle">GraphQL Profile</h1>
          <p id="status" class="muted">Loading…</p>
        </div>
        <div class="headerActions">
          <button id="refreshBtn" class="btnGhost" title="Re-fetch your data">Refresh</button>
          <button id="logoutBtn" class="btnDanger" title="Clear session">Logout</button>
        </div>
      </header>

      <section id="content" class="view" aria-live="polite">
        ${renderSkeleton()}
      </section>

      <footer class="foot muted">
        <span>JWT sub/id: <b>${userId ?? "?"}</b></span>
        <span>exp: <b>${payload?.exp ? new Date(payload.exp * 1000).toLocaleString() : "?"}</b></span>
      </footer>
    </div>
  `;

  document.querySelector("#logoutBtn").addEventListener("click", () => {
    logout();
    cached = null;
    cachedAt = 0;
    inflight = null;
    render();
  });

    document.querySelector("#refreshBtn").addEventListener("click", async () => {
      const status = document.querySelector("#status");
      const refreshBtn = document.querySelector("#refreshBtn");
      if (refreshBtn) refreshBtn.disabled = true;
      status.textContent = "Refreshing…";
      try {
        const data = await ensureProfileData(true);
        renderContent(data);
        if (data?.me?.login) status.textContent = `${data.me.login}`;
        else status.textContent = "Up to date";
      } catch (e) {
        status.textContent = "Failed to refresh: " + e.message;
      } finally {
        if (refreshBtn) refreshBtn.disabled = false;
      }
    });

  const status = document.querySelector("#status");
  const content = document.querySelector("#content");
  status.textContent = "Loading your data…";
  content.innerHTML = renderSkeleton();

  ensureProfileData(false)
    .then((data) => {
      status.textContent = `${data.me.login}`;
      renderContent(data);
    })
    .catch((e) => {
      status.textContent = "Failed to load: " + e.message;
      content.innerHTML = `
        <div class="grid">
          <div class="card">
            <h3>Couldn’t load your profile</h3>
            <p class="muted">${escapeHtml(e.message)}</p>
            <div class="actionsRow" style="margin-top:12px;">
              <button id="retryBtn" class="btnPrimary">Retry</button>
              <button id="logoutBtn2" class="btnGhost">Logout</button>
            </div>
          </div>
        </div>
      `;
      document.querySelector("#retryBtn")?.addEventListener("click", () => renderAuthed());
      document.querySelector("#logoutBtn2")?.addEventListener("click", () => {
        logout();
        cached = null;
        cachedAt = 0;
        inflight = null;
        render();
      });
    });
}

function renderSkeleton() {
  return `
    <div class="grid">
      <div class="card sk"></div>
      <div class="card sk"></div>
      <div class="card sk"></div>
      <div class="card sk"></div>
    </div>
  `;
}

async function ensureProfileData(force = false) {
  const token = getToken();
  if (!token) return null;

  // If a request is already running, reuse it even for "force" refresh.
  // This prevents rapid clicks (or duplicate renders) from triggering a loop
  // of overlapping fetches that feels like continuous refreshing.
  if (inflight) return inflight;

  const freshForMs = 20_000;
  if (!force && cached && Date.now() - cachedAt < freshForMs) return cached;

  inflight = loadProfileData(token)
    .then((data) => {
      cached = data;
      cachedAt = Date.now();
      inflight = null;
      return data;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });

  return inflight;
}

function renderContent(data) {
  const content = document.querySelector("#content");
  if (!content) return;
  if (!data) {
    content.innerHTML = renderSkeleton();
    return;
  }
  content.innerHTML = renderOnePage(data);
  bindViewHandlers();
}

// =======================
// Data loading
// =======================

async function loadProfileData(token) {
  const meQuery = `
    query Me {
      user {
        id
        login
      }
    }
  `;

  const xpQuery = `
    query XpTx($limit: Int!) {
      transaction(
        where: { type: { _eq: "xp" } }
        order_by: { createdAt: asc }
        limit: $limit
      ) {
        amount
        createdAt
        path
        type
      }
    }
  `;

  const auditsQuery = `
    query Audits($limit: Int!) {
      transaction(
        where: { type: { _in: ["up", "down"] } }
        order_by: { createdAt: desc }
        limit: $limit
      ) {
        amount
        type
        createdAt
        path
      }
    }
  `;

  const resultsQuery = `
    query Results($limit: Int!) {
      result(order_by: { createdAt: desc }, limit: $limit) {
        grade
        type
        createdAt
        path
        objectId
        user {
          id
          login
        }
      }
    }
  `;

  const bhModuleAuditsAggQuery = `
    query BhModuleAuditsAgg($pattern: String!) {
      up: transaction_aggregate(where: { path: { _ilike: $pattern }, type: { _eq: "up" } }) {
        aggregate { sum { amount } }
      }
      down: transaction_aggregate(where: { path: { _ilike: $pattern }, type: { _eq: "down" } }) {
        aggregate { sum { amount } }
      }
    }
  `;

  const bhModuleAllResultsQuery = `
    query BhModuleAllResults($pattern: String!, $limit: Int!) {
      result(
        where: { path: { _ilike: $pattern } }
        order_by: { createdAt: desc }
        limit: $limit
      ) {
        path
        grade
        createdAt
        updatedAt
        objectId
      }
    }
  `;

  let meData, xpData, auditsData, resultsData;
  try {
    [meData, xpData, auditsData, resultsData] = await Promise.all([
      gql(token, meQuery),
      gql(token, xpQuery, { limit: 5000 }),
      gql(token, auditsQuery, { limit: 5000 }),
      gql(token, resultsQuery, { limit: 5000 }),
    ]);
  } catch (e) {
    if (e instanceof GraphQLAuthError) {
      logout();
      renderLogin();
      const msg = document.querySelector("#msg");
      if (msg) {
        msg.textContent = "Session expired. Please sign in again.";
        msg.className = "msg err";
      }
      return;
    }
    throw e;
  }

  const me = meData.user?.[0];
  const tx = xpData.transaction || [];
  const auditTx = auditsData.transaction || [];
  const results = resultsData.result || [];
  if (!me) throw new Error("User data not found.");

  // ✅ BH-MODULE only, AND exclude onboarding/checkpoint/piscine under BH
  const bhOnlyTx = tx.filter(
    (t) => isBhModulePath(t.path) && !isExcludedBhXpPath(t.path)
  );

  const bhOnlyXp = calcXpTotals(bhOnlyTx);

  // audits (BH aggregate)
  let moduleAgg = {
    pass: 0,
    fail: 0,
    total: 0,
    up: 0,
    down: 0,
    ratio: 0,
    isFallback: true,
  };

  try {
    const a = await gql(token, bhModuleAuditsAggQuery, { pattern: MODULE_GQL_ILIKE });
    const up = Number(a?.up?.aggregate?.sum?.amount ?? 0);
    const down = Number(a?.down?.aggregate?.sum?.amount ?? 0);
    moduleAgg.up = up;
    moduleAgg.down = down;
    moduleAgg.ratio = down === 0 ? (up > 0 ? Infinity : 0) : up / down;
  } catch {
    const moduleAuditTx = auditTx.filter((t) => isBhModulePath(t.path));
    const mAudits = auditTotals(moduleAuditTx);
    moduleAgg.up = mAudits.up;
    moduleAgg.down = mAudits.down;
    moduleAgg.ratio = mAudits.ratio;
  }

  // pass/fail (BH projects only) — all-time attempts (every row counted)
  try {
    const allResults = await gql(token, bhModuleAllResultsQuery, {
      pattern: MODULE_GQL_ILIKE,
      limit: 8000,
    });

    const allModuleRows = (allResults?.result || []).filter((r) => isBhModulePath(r.path));
    const rows = allModuleRows.filter((r) => isBhModuleProject(r.path));

    const attempts = computeAttemptsPF(rows);
    moduleAgg.pass = attempts.success;
    moduleAgg.fail = attempts.fail;
    moduleAgg.total = attempts.total;

    moduleAgg.isFallback = false;
  } catch {
    const moduleResults = results
      .filter((r) => isBhModulePath(r.path))
      .filter((r) => isBhModuleProject(r.path));

    const attempts = computeAttemptsPF(moduleResults);
    moduleAgg.pass = attempts.success;
    moduleAgg.fail = attempts.fail;
    moduleAgg.total = attempts.total;

    moduleAgg.isFallback = true;
  }

  return {
    me,
    tx,
    bhOnlyTx,
    bhOnlyXp,
    auditTx,
    results,
    moduleAgg,
  };
}

// =======================
// View
// =======================

function renderOnePage(data) {
  const range = Number(uiState.rangeDays);
  const period = uiState.period;

  const filtered = filterByLastDays(data.bhOnlyTx, range);
  const grouped = groupXpByPeriod(filtered, period);
  const cumulative = toCumulative(grouped);

  const statsAudits = data.moduleAgg
    ? { up: data.moduleAgg.up, down: data.moduleAgg.down, ratio: data.moduleAgg.ratio }
    : auditTotals(filterByLastDays(data.auditTx, range).filter((t) => isBhModulePath(t.path)));

  // all-time attempts (every row counted, no dedup)
  const statsAttempts = data.moduleAgg
    ? { success: data.moduleAgg.pass, fail: data.moduleAgg.fail, total: data.moduleAgg.total }
    : computeAttemptsPF(data.results.filter((r) => isBhModuleProject(r.path)));

  const rangeLabel =
    !Number.isFinite(range) || range <= 0
      ? "All time"
      : range === 180
      ? "Last 6 months"
      : `Last ${range} days`;

  const statsPassText = statsAttempts.total ? `${statsAttempts.success} / ${statsAttempts.total}` : "0";

  return `
    <div class="section">
      <div class="sectionHeader">
        <h2 class="sectionTitle">Overview</h2>
      </div>

      <div class="grid">
        <div class="card">
          <h3>Identification</h3>
          <div class="kv">
            <div><span class="k">Login</span><span class="v">${escapeHtml(data.me.login)}</span></div>
            <div><span class="k">User ID</span><span class="v">${data.me.id}</span></div>
          </div>
        </div>

        <div class="card">
          <h3>XP Earned — ${MODULE_NAME}</h3>
          <div class="kv">
            <div><span class="k">Total</span><span class="v">${formatXp(data.bhOnlyXp.net)}</span></div>
            <div><span class="k">Removed</span><span class="v">${formatXp(data.bhOnlyXp.removed)}</span></div>
          </div>
          <p class="muted small" style="margin:10px 0 0;">
            BH-MODULE
          </p>
        </div>

        <div class="card">
          <h3>Audit Ratio — ${MODULE_NAME}</h3>
          <div class="kv">
            <div><span class="k">Done</span><span class="v">${formatXp(statsAudits.up)}</span></div>
            <div><span class="k">Received</span><span class="v">${formatXp(statsAudits.down)}</span></div>
            <div><span class="k">Ratio</span><span class="v">${Number.isFinite(statsAudits.ratio) ? statsAudits.ratio.toFixed(1) : "∞"}</span></div>
          </div>
        </div>

        <div class="card">
          <h3>${MODULE_NAME} Pass / Fail</h3>
          <div class="kv">
            <div><span class="k">Success</span><span class="v" style="color:var(--green)">${statsAttempts.success}</span></div>
            <div><span class="k">Fail</span><span class="v" style="color:var(--red)">${statsAttempts.fail}</span></div>
          </div>
          <p class="muted small" style="margin:10px 0 0">
            All-time attempts · BH-MODULE${data.moduleAgg?.isFallback ? " · fallback" : ""}
          </p>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="sectionHeader">
        <h2 class="sectionTitle">Statistics</h2>
        <div class="controls">
          <label class="control">
            Range
            <select id="rangeSel">
              <option value="30" ${range === 30 ? "selected" : ""}>30 days</option>
              <option value="90" ${range === 90 ? "selected" : ""}>90 days</option>
              <option value="180" ${range === 180 ? "selected" : ""}>6 months</option>
              <option value="365" ${range === 365 ? "selected" : ""}>1 year</option>
              <option value="0" ${range === 0 ? "selected" : ""}>All time</option>
            </select>
          </label>
          <label class="control">
            Group
            <select id="periodSel">
              <option value="day" ${period === "day" ? "selected" : ""}>Day</option>
              <option value="week" ${period === "week" ? "selected" : ""}>Week</option>
              <option value="month" ${period === "month" ? "selected" : ""}>Month</option>
            </select>
          </label>
        </div>
      </div>

      <div class="grid">
        <div class="card" style="grid-column: 1 / -1;">
          <h3>XP Progress — ${MODULE_NAME}</h3>
          <p class="muted small" style="margin:0 0 12px;">${escapeHtml(rangeLabel)} · cumulative</p>
          ${lineChartSvg(cumulative)}
        </div>

        <div class="card">
          <h3>Audit Ratio — ${MODULE_NAME}</h3>
          ${donutChartSvg(
            [
              { label: "Done", value: statsAudits.up, color: "var(--green)" },
              { label: "Received", value: statsAudits.down, color: "var(--red)" },
            ],
            {
              ariaLabel: "Audits done vs received",
              centerValue: Number.isFinite(statsAudits.ratio) ? statsAudits.ratio.toFixed(1) : "∞",
              centerLabel: "ratio",
              size: 280,
            }
          )}
          <div class="kv" style="margin-top:12px;">
            <div><span class="k">Done</span><span class="v">${formatXp(statsAudits.up)}</span></div>
            <div><span class="k">Received</span><span class="v">${formatXp(statsAudits.down)}</span></div>
          </div>
        </div>

        <div class="card">
          <h3>Pass / Fail — ${MODULE_NAME}</h3>
          ${donutChartSvg(
            [
              { label: "Success", value: statsAttempts.success, color: "var(--green)" },
              { label: "Fail", value: statsAttempts.fail, color: "var(--red)" },
            ],
            {
              ariaLabel: "Pass fail ratio",
              centerValue: statsPassText,
              centerLabel: "success / total",
              showPercent: false,
              size: 280,
            }
          )}
          <p class="muted small" style="margin:12px 0 0">All-time attempts</p>
        </div>
      </div>
    </div>
  `;
}

function bindViewHandlers() {
  const rangeSel = document.querySelector("#rangeSel");
  const periodSel = document.querySelector("#periodSel");
  if (rangeSel) {
    rangeSel.addEventListener("change", () => {
      uiState.rangeDays = Number(rangeSel.value);
      persistUiState();
      renderContent(cached);
    });
  }
  if (periodSel) {
    periodSel.addEventListener("change", () => {
      uiState.period = String(periodSel.value);
      persistUiState();
      renderContent(cached);
    });
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

initUiState();
render();
