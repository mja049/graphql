export function lineChartSvg(points, opts = {}) {
  const width = opts.width ?? 800;
  const height = opts.height ?? 260;
  const padLeft = opts.padLeft ?? 64;
  const padRight = opts.padRight ?? 30;
  const padTop = opts.padTop ?? 28;
  const padBottom = opts.padBottom ?? 44;

  if (!points.length) {
    return `<svg class="chart" viewBox="0 0 ${width} ${height}">
      <text x="20" y="40" class="label">No data</text>
    </svg>`;
  }

  const rawMin = Math.min(...points.map((p) => p.value));
  const rawMax = Math.max(...points.map((p) => p.value));
  // When all values are equal (single data point), anchor to 0 so the
  // Y-axis shows a meaningful scale instead of flat identical ticks.
  const minY = rawMin === rawMax ? 0 : rawMin;
  const maxY = rawMax;
  const yRange = maxY - minY || 1;

  // Center a single point horizontally instead of pinning to left edge.
  const xScale = (i) =>
    points.length === 1
      ? padLeft + (width - padLeft - padRight) / 2
      : padLeft + (i * (width - padLeft - padRight)) / (points.length - 1);

  const yScale = (v) =>
    padTop + ((maxY - v) * (height - padTop - padBottom)) / yRange;

  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xScale(i).toFixed(2)} ${yScale(p.value).toFixed(2)}`
    )
    .join(" ");

  const gridLines = 4;
  const grids = Array.from({ length: gridLines + 1 }, (_, i) => {
    const y = padTop + (i * (height - padTop - padBottom)) / gridLines;
    return `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" class="grid" />`;
  }).join("");

  const first = points[0].day;
  const last = points[points.length - 1].day;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = maxY - (i * yRange) / ticks;
    const y = yScale(v);
    return {
      y,
      label: formatCompactNumber(v),
    };
  });

  return `
  <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="XP over time">
    ${grids}
    <line x1="${padLeft}" y1="${height - padBottom}" x2="${width - padRight}" y2="${height - padBottom}" class="axis" />
    <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${height - padBottom}" class="axis" />

    ${yTicks
      .map(
        (t) =>
          `<text x="${padLeft - 10}" y="${t.y + 4}" class="label" text-anchor="end">${escapeXml(
            t.label
          )}</text>`
      )
      .join("")}

    <path d="${d}" fill="none" class="line" stroke-width="3.25"></path>

    ${points
      .map((p, i) => {
        const cx = xScale(i);
        const cy = yScale(p.value);
        return `
          <g class="pt">
            <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.5" class="dot"></circle>
            <title>${escapeXml(p.day)} • ${formatCompactNumber(p.value)}</title>
          </g>
        `;
      })
      .join("")}

    ${points.length === 1
      ? `<text x="${(padLeft + width - padRight) / 2}" y="${height - 12}" class="label" text-anchor="middle">${first}</text>`
      : `<text x="${padLeft}" y="${height - 12}" class="label">${first}</text>
    <text x="${width - padRight}" y="${height - 12}" class="label" text-anchor="end">${last}</text>`
    }
  </svg>`;
}

export function barChartSvg(items, opts = {}) {
  const width = opts.width ?? 800;
  const height = opts.height ?? 340;

  // ✅ bigger bottom padding so rotated labels fit
  const pad = opts.pad ?? 60;

  if (!items.length) {
    return `<svg class="chart" viewBox="0 0 ${width} ${height}">
      <text x="20" y="40" class="label">No data</text>
    </svg>`;
  }

  const max = Math.max(...items.map((x) => x.xp)) || 1;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;

  const gap = 10;
  const barW = (chartW - gap * (items.length - 1)) / items.length;

  const x = (i) => pad + i * (barW + gap);
  const h = (v) => (Math.max(0, v) * chartH) / max;
  const y = (v) => pad + (chartH - h(v));

  const gridLines = 4;
  const grids = Array.from({ length: gridLines + 1 }, (_, i) => {
    const yy = pad + (i * chartH) / gridLines;
    return `<line x1="${pad}" y1="${yy}" x2="${width - pad}" y2="${yy}" class="grid" />`;
  }).join("");

  return `
  <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Top XP by path">
    ${grids}
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis" />

    ${items
      .map((it, i) => {
        const rx = x(i);
        const ry = y(it.xp);
        const rh = h(it.xp);

        const shortLabel = escapeXml(it.label);
        const fullLabel = escapeXml(it.path);

        // rotated label anchor point
        const lx = rx + barW / 2;
        const ly = height - pad + 26;

        return `
          <g>
            <rect class="bar" x="${rx}" y="${ry}" width="${barW}" height="${rh}" rx="8"></rect>

            <!-- ✅ tooltip (hover) shows full path + exact xp -->
            <title>${fullLabel} • ${formatCompactNumber(it.xp)}</title>

            <!-- ✅ rotated labels to avoid overlap -->
            <text
              x="${lx}"
              y="${ly}"
              class="label"
              text-anchor="end"
              transform="rotate(-45 ${lx} ${ly})"
            >
              ${shortLabel}
            </text>
          </g>
        `;
      })
      .join("")}
  </svg>`;
}

export function donutChartSvg(slices, opts = {}) {
  const size = opts.size ?? 320;
  const stroke = opts.stroke ?? 26;
  const pad = opts.pad ?? 14;
  const showPercent = opts.showPercent ?? true;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - pad * 2 - stroke) / 2;
  const c = 2 * Math.PI * r;

  const safeSlices = (slices || [])
    .filter((s) => Number.isFinite(s.value) && s.value > 0)
    .map((s) => ({
      label: String(s.label ?? ""),
      value: s.value,
      color: String(s.color || "var(--accent)"),
    }));

  const total = safeSlices.reduce((a, s) => a + s.value, 0);
  if (!total) {
    return `<svg class="chart" viewBox="0 0 ${size} ${size}">
      <text x="20" y="40" class="label">No data</text>
    </svg>`;
  }

  let offset = 0;
  const arcs = safeSlices
    .map((s) => {
      const frac = s.value / total;
      const len = frac * c;
      const dash = `${len.toFixed(2)} ${(c - len).toFixed(2)}`;
      const dashOffset = (-offset).toFixed(2);
      offset += len;

      const pct = Math.round(frac * 100);
      const titleText = showPercent
        ? `${s.label} • ${formatCompactNumber(s.value)} (${pct}%)`
        : `${s.label} • ${formatCompactNumber(s.value)}`;

      return `
        <circle
          class="donut"
          cx="${cx}"
          cy="${cy}"
          r="${r}"
          fill="transparent"
          stroke="${escapeXml(s.color)}"
          stroke-width="${stroke}"
          stroke-dasharray="${dash}"
          stroke-dashoffset="${dashOffset}"
          stroke-linecap="round"
        >
          <title>${escapeXml(titleText)}</title>
        </circle>
      `;
    })
    .join("");

  const centerLabel = opts.centerLabel ?? "";
  const centerValue = opts.centerValue ?? "";

  return `
    <svg class="chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeXml(
      opts.ariaLabel || "Distribution"
    )}">
      <g transform="rotate(-90 ${cx} ${cy})">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="transparent" stroke="rgba(255,255,255,0.08)" stroke-width="${stroke}"></circle>
        ${arcs}
      </g>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donutCenterValue">${escapeXml(
        String(centerValue)
      )}</text>
      <text x="${cx}" y="${cy + 20}" text-anchor="middle" class="donutCenterLabel">${escapeXml(
        String(centerLabel)
      )}</text>
    </svg>
  `;
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatCompactNumber(n) {
  const abs = Math.abs(Number(n));
  const sign = n < 0 ? "-" : "";
  if (!Number.isFinite(abs)) return String(n);

  if (abs >= 1_000_000_000) return `${sign}${Math.round(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}${Math.round(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

