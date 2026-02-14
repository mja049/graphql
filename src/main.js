import "./style.css";
import {
  login,
  getToken,
  logout,
  decodeJwtPayload,
  getUserIdFromToken,
} from "./lib/auth.js";
import { gql, GraphQLAuthError } from "./lib/graphql.js";
import {
  splitXp,
  filterByLastDays,
  groupXpByPeriod,
  toCumulative,
  formatXp,
  auditTotals,
  passFailCounts,
} from "./lib/stats.js";
import { lineChartSvg, donutChartSvg } from "./lib/charts.js";

let cached = null;
let cachedAt = 0;
let inflight = null;

const MODULE_NAME = "BH-MODULE";
const MODULE_PATH_RE = /bh[-_]?module/i;
// Keep this broad because paths vary (BH-MODULE, bh-module, bh_module, etc.)
const MODULE_GQL_ILIKE = "%bh%module%";

function isModulePath(path) {
  return MODULE_PATH_RE.test(String(path || ""));
}

// Patterns that are NOT standalone projects inside the module
const NON_PROJECT_RE = /piscine|checkpoint|onboarding/i;

/**
 * Returns true only for real top-level module projects.
 * Path shape: /<user>/bh-module/<project-name>  (exactly 1 segment after module)
 * Excludes: piscine-*, checkpoint, onboarding, and any deeper sub-paths.
 */
function isModuleProject(path) {
  const p = String(path || "");
  if (!isModulePath(p)) return false;

  const parts = p.split("/").filter(Boolean);
  const modIdx = parts.findIndex((s) => MODULE_PATH_RE.test(s));
  if (modIdx < 0) return false;

  // Must have exactly one segment after the module
  if (parts.length !== modIdx + 2) return false;

  // The project segment itself must not be a piscine/checkpoint
  const projectSeg = parts[modIdx + 1];
  if (NON_PROJECT_RE.test(projectSeg)) return false;

  return true;
}

const uiState = {
  rangeDays: 0,
  period: "day", // day | week | month
};

function initUiState() {
  try {
    const range = sessionStorage.getItem("rangeDays");
    const period = sessionStorage.getItem("period");
    if (range) uiState.rangeDays = Number(range);
    if (period) uiState.period = period;
  } catch {
    // ignore
  }
}

function persistUiState() {
  try {
    sessionStorage.setItem("rangeDays", String(uiState.rangeDays));
    sessionStorage.setItem("period", uiState.period);
  } catch {
    // ignore
  }
}

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
    status.textContent = "Refreshing…";
    try {
      await ensureProfileData(true);
      renderContent(cached);
    } catch (e) {
      status.textContent = "Failed to refresh: " + e.message;
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

  const freshForMs = 20_000;
  if (!force && cached && Date.now() - cachedAt < freshForMs) return cached;
  if (!force && inflight) return inflight;

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
  bindViewHandlers(data);
}

async function loadProfileData(token) {
  if (!token) throw new Error("Missing session token.");

  // ✅ normal query + nested selection
  const meQuery = `
    query Me {
      user {
        id
        login
      }
    }
  `;

  // ✅ arguments (variables) + filtering
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

  // ✅ audits (up/down)
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

  // ✅ skills
  // ✅ results for pass/fail (and nested user to demonstrate nesting)
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

  // ✅ arguments + aggregates (all-time BH-MODULE audits)
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

  // ✅ All attempts for BH-MODULE — counts every attempt (pass & fail)
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
      }
    }
  `;

  let meData, xpData, auditsData, resultsData;
  try {
    [meData, xpData, auditsData, resultsData] = await Promise.all([
      gql(token, meQuery),
      gql(token, xpQuery, { limit: 2500 }),
      gql(token, auditsQuery, { limit: 2500 }),
      gql(token, resultsQuery, { limit: 2500 }),
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

  const xp = splitXp(tx);
  const daily = groupXpByPeriod(tx, "day");
  const cumulative = toCumulative(daily);

  const audits = auditTotals(auditTx);
  const pf = passFailCounts(results);

  // All-time BH-MODULE:
  // - audits: via transaction_aggregate
  // - project pass/fail: all attempts (so retries like make-your-game fail+pass both count)
  let moduleAgg = { pass: 0, fail: 0, total: 0, up: 0, down: 0, ratio: 0, isFallback: true };

  // audits aggregates
  try {
    const a = await gql(token, bhModuleAuditsAggQuery, { pattern: MODULE_GQL_ILIKE });
    const up = Number(a?.up?.aggregate?.sum?.amount ?? 0);
    const down = Number(a?.down?.aggregate?.sum?.amount ?? 0);
    moduleAgg.up = up;
    moduleAgg.down = down;
    moduleAgg.ratio = down === 0 ? (up > 0 ? Infinity : 0) : up / down;
  } catch {
    const moduleAuditTx = auditTx.filter((t) => isModulePath(t.path));
    const mAudits = auditTotals(moduleAuditTx);
    moduleAgg.up = mAudits.up;
    moduleAgg.down = mAudits.down;
    moduleAgg.ratio = mAudits.ratio;
  }

  // All attempts for pass/fail (counts every attempt including retries)
  try {
    const allResults = await gql(token, bhModuleAllResultsQuery, {
      pattern: MODULE_GQL_ILIKE,
      limit: 5000,
    });

    const allModuleRows = (allResults?.result || []).filter((r) => isModulePath(r.path));
    // Keep only real top-level projects + piscines (not sub-exercises / checkpoints)
    const rows = allModuleRows.filter((r) => isModuleProject(r.path));
    const mPf = passFailCounts(rows);
    moduleAgg.pass = mPf.pass;
    moduleAgg.fail = mPf.fail;
    moduleAgg.total = mPf.total;
    moduleAgg.isFallback = false;
  } catch {
    // Fallback: use locally fetched results (may be limited)
    const moduleResults = results.filter((r) => isModulePath(r.path));
    const mPf = passFailCounts(moduleResults);
    moduleAgg.pass = mPf.pass;
    moduleAgg.fail = mPf.fail;
    moduleAgg.total = mPf.total;
    moduleAgg.isFallback = true;
  }

  return {
    me,
    tx,
    auditTx,
    results,
    xp,
    daily,
    cumulative,
    audits,
    pf,
    moduleAgg,
  };
}

function renderOnePage(data) {
  const range = Number(uiState.rangeDays);
  const period = uiState.period;
  // Statistics are required, but here we scope them to BH-MODULE only.
  const filtered = filterByLastDays(data.tx, range);
  const moduleXpTx = filtered.filter((t) => isModulePath(t.path));
  const grouped = groupXpByPeriod(moduleXpTx, period);
  const cumulative = toCumulative(grouped);

  const statsAudits = data.moduleAgg
    ? { up: data.moduleAgg.up, down: data.moduleAgg.down, ratio: data.moduleAgg.ratio }
    : auditTotals(filterByLastDays(data.auditTx, range).filter((t) => isModulePath(t.path)));
  const statsPf = data.moduleAgg
    ? { pass: data.moduleAgg.pass, fail: data.moduleAgg.fail, total: data.moduleAgg.total }
    : passFailCounts(filterByLastDays(data.results, range).filter((r) => isModulePath(r.path)));

  const rangeLabel = !Number.isFinite(range) || range <= 0 ? "All time" : `Last ${range} days`;
  const statsPassText = statsPf.total ? `${statsPf.pass} / ${statsPf.total}` : "0";

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
        <h3>XP Earned</h3>
        <div class="kv">
          <div><span class="k">Total</span><span class="v">${formatXp(data.xp.earned)}</span></div>
          ${data.xp.removed ? `<div><span class="k">Removed</span><span class="v">${formatXp(data.xp.removed)}</span></div>` : ``}
        </div>
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
          <div><span class="k">Pass</span><span class="v" style="color:var(--green)">${statsPf.pass}</span></div>
          <div><span class="k">Fail</span><span class="v" style="color:var(--red)">${statsPf.fail}</span></div>
        </div>
        <p class="muted small" style="margin:10px 0 0">All attempts in ${MODULE_NAME}${data.moduleAgg?.isFallback ? " · fallback" : ""}</p>
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
              { label: "Pass", value: statsPf.pass, color: "var(--green)" },
              { label: "Fail", value: statsPf.fail, color: "var(--red)" },
            ],
            {
              ariaLabel: "Pass fail ratio",
              centerValue: statsPassText,
              centerLabel: "pass / total",
              showPercent: false,
              size: 280,
            }
          )}
          <p class="muted small" style="margin:12px 0 0">All-time project attempts</p>
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
