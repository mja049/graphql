export function splitXp(tx) {
  let earned = 0;
  let removed = 0;

  for (const t of tx) {
    if (t.amount >= 0) earned += t.amount;
    else removed += Math.abs(t.amount);
  }

  return { earned, removed, net: earned - removed };
}

export function groupByDay(tx) {
  // Sum XP per day (YYYY-MM-DD)
  const m = new Map();

  for (const t of tx) {
    const day = t.createdAt.slice(0, 10);
    m.set(day, (m.get(day) || 0) + t.amount);
  }

  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, xp]) => ({ day, xp }));
}

export function filterByLastDays(tx, days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return tx;
  const cutoff = Date.now() - n * 24 * 60 * 60 * 1000;
  return tx.filter((t) => {
    const ts = Date.parse(t.createdAt);
    return Number.isFinite(ts) ? ts >= cutoff : true;
  });
}

export function groupByWeek(tx) {
  // ISO-ish week buckets: YYYY-Www (Monday as start)
  const m = new Map();
  for (const t of tx) {
    const d = new Date(t.createdAt);
    if (!Number.isFinite(d.getTime())) continue;
    // shift to Monday
    const day = (d.getDay() + 6) % 7; // 0=Mon
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    const y = d.getFullYear();
    const first = new Date(y, 0, 1);
    const diff = (d - first) / 86400000;
    const week = String(Math.floor((diff + ((first.getDay() + 6) % 7)) / 7) + 1).padStart(2, "0");
    const key = `${y}-W${week}`;
    m.set(key, (m.get(key) || 0) + t.amount);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, xp]) => ({ day, xp }));
}

export function groupByMonth(tx) {
  // YYYY-MM
  const m = new Map();
  for (const t of tx) {
    const key = String(t.createdAt).slice(0, 7);
    m.set(key, (m.get(key) || 0) + t.amount);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, xp]) => ({ day, xp }));
}

export function groupXpByPeriod(tx, period) {
  if (period === "week") return groupByWeek(tx);
  if (period === "month") return groupByMonth(tx);
  return groupByDay(tx);
}

export function toCumulative(series) {
  let acc = 0;
  return series.map((p) => {
    acc += p.xp;
    return { day: p.day, value: acc };
  });
}

export function topByPath(tx, n = 10) {
  const m = new Map();

  for (const t of tx) {
    m.set(t.path, (m.get(t.path) || 0) + t.amount);
  }

  return [...m.entries()]
    .map(([path, xp]) => ({ path, xp }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, n)
    .map((x) => ({
      ...x,
      label: shortPathLabel(x.path),
    }));
}

export function auditTotals(tx) {
  // Many 01 GraphQL schemas expose audits as transactions with type "up" and "down".
  // If your schema differs, adjust the filters in the GraphQL query.
  let up = 0;
  let down = 0;

  for (const t of tx) {
    if (t.type === "up") up += Math.max(0, t.amount);
    if (t.type === "down") down += Math.max(0, t.amount);
  }

  const ratio = down === 0 ? (up > 0 ? Infinity : 0) : up / down;
  return { up, down, ratio };
}

export function passFailCounts(results) {
  let pass = 0;
  let fail = 0;

  for (const r of results) {
    // grade > 0 => pass, grade === 0 => fail
    const grade = r?.grade;
    if (!Number.isFinite(grade)) continue;
    if (grade > 0) pass += 1;
    else fail += 1;
  }

  return { pass, fail, total: pass + fail };
}

export function topSkillsFromTransactions(tx, n = 10) {
  // Convention: skill transactions are stored as type "skill_xxx".
  const m = new Map();

  for (const t of tx) {
    if (!t.type || !t.type.startsWith("skill_")) continue;
    m.set(t.type, (m.get(t.type) || 0) + t.amount);
  }

  return [...m.entries()]
    .map(([type, amount]) => ({ type, amount, label: type.replace(/^skill_/, "") }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

// ✅ short, readable labels for the bar chart
function shortPathLabel(path) {
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || path; // last segment

  // shorten with ellipsis
  return last.length > 14 ? last.slice(0, 13) + "…" : last;
}

export function formatXp(amount) {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)} MB`;
  if (abs >= 1_000) {
  const kb = abs / 1_000;
  return `${sign}${Math.round(kb)} kB`;
}
  return `${sign}${abs} B`;
}
