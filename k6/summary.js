import { ENDPOINTS } from './config.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function valuesOf(metric) {
  if (!metric) {
    return {};
  }
  return metric.values || metric;
}

function num(metric, key) {
  const values = valuesOf(metric);
  const value = values[key];
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

function fmtMs(value) {
  if (value == null) {
    return '—';
  }
  return `${Math.round(value)} ms`;
}

function fmtPct(value) {
  if (value == null) {
    return '—';
  }
  return `${(value * 100).toFixed(2)}%`;
}

function fmtCount(value) {
  if (value == null) {
    return '—';
  }
  return String(Math.round(value));
}

function collectChecks(group, out) {
  if (!group) {
    return;
  }
  for (const check of group.checks || []) {
    out.push({
      name: check.name || check.path || 'check',
      passes: check.passes || 0,
      fails: check.fails || 0,
    });
  }
  for (const child of group.groups || []) {
    collectChecks(child, out);
  }
}

function parseEndpoints(metrics, slaP95Ms) {
  return ENDPOINTS.map((ep) => {
    const lat = metrics[`lat_${ep.key}`];
    const count = num(metrics[`n_${ep.key}`], 'count');
    const failRate = num(metrics[`fail_${ep.key}`], 'rate');
    const p95 = num(lat, 'p(95)');
    const ok = (failRate == null || failRate === 0) && (p95 == null || p95 < slaP95Ms);
    return {
      name: ep.name,
      count,
      failRate,
      min: num(lat, 'min'),
      avg: num(lat, 'avg'),
      p90: num(lat, 'p(90)'),
      p95,
      p99: num(lat, 'p(99)'),
      max: num(lat, 'max'),
      ok,
    };
  }).filter((row) => row.count != null);
}

function thresholdRows(metrics) {
  const rows = [];
  for (const [name, metric] of Object.entries(metrics || {})) {
    if (!metric.thresholds) {
      continue;
    }
    for (const [expr, result] of Object.entries(metric.thresholds)) {
      const actual =
        name === 'http_req_duration'
          ? fmtMs(num(metric, 'p(95)'))
          : name === 'http_req_failed' || name === 'checks'
            ? fmtPct(num(metric, 'rate'))
            : '—';
      rows.push({
        metric: name,
        rule: expr,
        actual,
        ok: !!(result && result.ok),
      });
    }
  }
  return rows;
}

function renderBars(endpoints) {
  if (!endpoints.length) {
    return '<p>No endpoint samples in this run.</p>';
  }
  const max = Math.max(...endpoints.map((e) => e.p95 || 0), 1);
  return endpoints
    .map((e) => {
      const width = Math.max(4, Math.round(((e.p95 || 0) / max) * 100));
      const fail = (e.failRate || 0) > 0;
      return `<div class="bar-row">
        <div class="bar-label">${esc(e.name)}</div>
        <div class="bar-track"><span class="bar-fill ${fail ? 'bad' : ''}" style="width:${width}%"></span></div>
        <div class="bar-value">${fmtMs(e.p95)}</div>
      </div>`;
    })
    .join('');
}

function renderHtml(model) {
  const statusClass = model.failed ? 'fail' : 'pass';
  const statusText = model.failed ? 'Thresholds failed' : 'Thresholds passed';
  const checkRows = model.checks
    .map((c) => {
      const total = c.passes + c.fails;
      const ok = c.fails === 0;
      return `<tr>
        <td>${esc(c.name)}</td>
        <td>${c.passes}</td>
        <td>${c.fails}</td>
        <td>${total ? ((c.passes / total) * 100).toFixed(1) : '0.0'}%</td>
        <td class="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'}</td>
      </tr>`;
    })
    .join('');
  const endpointRows = model.endpoints
    .map((e) => {
      return `<tr>
        <td><code>${esc(e.name)}</code></td>
        <td>${fmtCount(e.count)}</td>
        <td>${fmtMs(e.min)}</td>
        <td>${fmtMs(e.avg)}</td>
        <td>${fmtMs(e.p90)}</td>
        <td><strong>${fmtMs(e.p95)}</strong></td>
        <td>${fmtMs(e.p99)}</td>
        <td>${fmtMs(e.max)}</td>
        <td class="${e.failRate ? 'fail' : 'pass'}">${fmtPct(e.failRate)}</td>
        <td class="${e.ok ? 'pass' : 'fail'}">${e.ok ? 'PASS' : 'FAIL'}</td>
      </tr>`;
    })
    .join('');
  const thresholdRowsHtml = model.thresholds
    .map(
      (t) => `<tr>
        <td><code>${esc(t.metric)}</code></td>
        <td>${esc(t.rule)}</td>
        <td>${esc(t.actual)}</td>
        <td class="${t.ok ? 'pass' : 'fail'}">${t.ok ? 'PASS' : 'FAIL'}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Toolshop API — k6 ${esc(model.profile)}</title>
  <style>
    :root { --navy:#0f2744; --accent:#2f6fed; --ok:#0f7b4c; --bad:#c62828; --bg:#f3f5f8; --card:#fff; --line:#e4e8ee; --muted:#5b6777; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Segoe UI, system-ui, sans-serif; background: var(--bg); color: #1b2430; }
    .hero { background: linear-gradient(135deg, var(--navy), #1c4f8f); color: #fff; padding: 28px 32px 24px; }
    .hero h1 { margin: 0 0 6px; font-size: 26px; font-weight: 650; }
    .hero p { margin: 0; opacity: 0.88; }
    .badge { display: inline-block; margin-top: 12px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .badge.pass { background: #d9f5e5; color: var(--ok); }
    .badge.fail { background: #fde2e2; color: var(--bad); }
    .wrap { max-width: 1100px; margin: -18px auto 40px; padding: 0 20px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; box-shadow: 0 1px 2px rgba(15,39,68,0.04); }
    .kpi .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
    h2 { margin: 8px 0 12px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); border-bottom: 1px solid var(--line); padding: 8px 6px; }
    td { border-bottom: 1px solid var(--line); padding: 9px 6px; vertical-align: middle; }
    code { font-family: Consolas, ui-monospace, monospace; font-size: 12px; }
    .pass { color: var(--ok); font-weight: 700; }
    .fail { color: var(--bad); font-weight: 700; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; color: var(--muted); font-size: 13px; }
    .meta b { color: #1b2430; }
    .bar-row { display: grid; grid-template-columns: 220px 1fr 80px; gap: 10px; align-items: center; margin: 8px 0; font-size: 13px; }
    .bar-track { height: 10px; background: #e8edf4; border-radius: 99px; overflow: hidden; }
    .bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
    .bar-fill.bad { background: var(--bad); }
    .bar-value { text-align: right; font-variant-numeric: tabular-nums; }
    .journey { display: flex; flex-wrap: wrap; gap: 8px; }
    .step { flex: 1 1 140px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: #fbfcfe; }
    .step.bad { border-color: #f3b4b4; background: #fff6f6; }
    .step .n { font-size: 11px; color: var(--muted); }
    .step .t { font-size: 12px; font-weight: 650; margin: 4px 0; }
    footer { margin-top: 18px; color: var(--muted); font-size: 12px; }
    @media (max-width: 860px) { .kpis, .meta { grid-template-columns: 1fr 1fr; } .bar-row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header class="hero">
    <h1>Toolshop API performance</h1>
    <p>k6 ${esc(model.profile)} · authenticated register → login → catalog → cart</p>
    <span class="badge ${statusClass}">${statusText}</span>
  </header>
  <div class="wrap">
    <section class="kpis">
      <div class="card kpi"><div class="label">p95 latency</div><div class="value">${fmtMs(model.p95)}</div></div>
      <div class="card kpi"><div class="label">p99 latency</div><div class="value">${fmtMs(model.p99)}</div></div>
      <div class="card kpi"><div class="label">HTTP errors</div><div class="value">${fmtPct(model.failRate)}</div></div>
      <div class="card kpi"><div class="label">Checks</div><div class="value">${fmtPct(model.checkRate)}</div></div>
    </section>

    <section class="card" style="margin-bottom:18px;">
      <h2>Run configuration</h2>
      <div class="meta">
        <div>Target <b>${esc(model.baseUrl)}</b></div>
        <div>Profile <b>${esc(model.profile)}</b></div>
        <div>Virtual users <b>${esc(model.vus)}</b></div>
        <div>Iterations <b>${fmtCount(model.iterations)}</b></div>
        <div>HTTP requests <b>${fmtCount(model.httpReqs)}</b></div>
        <div>Duration <b>${esc(model.duration)}</b></div>
        <div>Generated <b>${esc(model.generatedAt)}</b></div>
        <div>SLA <b>errors &lt; 5% · p95 &lt; ${esc(model.slaP95)}</b></div>
      </div>
    </section>

    <section class="card" style="margin-bottom:18px;">
      <h2>Authenticated journey</h2>
      <div class="journey">
        ${model.endpoints
          .map((e, i) => `<div class="step ${e.ok ? '' : 'bad'}"><div class="n">Step ${i + 1}</div><div class="t">${esc(e.name)}</div><div>${fmtCount(e.count)} calls · ${fmtMs(e.p95)} p95</div></div>`)
          .join('')}
      </div>
    </section>

    <section class="card" style="margin-bottom:18px;">
      <h2>Latency by endpoint (p95)</h2>
      ${renderBars(model.endpoints)}
    </section>

    <section class="card" style="margin-bottom:18px;">
      <h2>Endpoint metrics</h2>
      <table>
        <thead><tr><th>Request</th><th>Count</th><th>Min</th><th>Avg</th><th>p90</th><th>p95</th><th>p99</th><th>Max</th><th>Fail</th><th>vs SLA</th></tr></thead>
        <tbody>${endpointRows || '<tr><td colspan="10">No endpoint metrics</td></tr>'}</tbody>
      </table>
    </section>

    <section class="card" style="margin-bottom:18px;">
      <h2>Functional checks</h2>
      <table>
        <thead><tr><th>Check</th><th>Pass</th><th>Fail</th><th>Rate</th><th>Result</th></tr></thead>
        <tbody>${checkRows || '<tr><td colspan="5">No checks recorded</td></tr>'}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>SLA thresholds</h2>
      <table>
        <thead><tr><th>Metric</th><th>Rule</th><th>Actual</th><th>Result</th></tr></thead>
        <tbody>${thresholdRowsHtml}</tbody>
      </table>
    </section>
    <footer>Agency performance template · k6 HTML report generated after the run. Machine-readable JSON is saved next to this file.</footer>
  </div>
</body>
</html>`;
}

export function handleSummary(data) {
  const profile = __ENV.PROFILE || 'k6';
  const metrics = data.metrics || {};
  const checks = [];
  collectChecks(data.root_group, checks);
  const slaP95Ms = Number(__ENV.FAIL_DEMO === '1' ? 1 : __ENV.P95_MS || 3000);
  const endpoints = parseEndpoints(metrics, slaP95Ms);
  const rows = thresholdRows(metrics);
  const failed = rows.some((row) => !row.ok);
  const durationMs = (data.state && data.state.testRunDurationMs) || num(metrics.iteration_duration, 'avg');
  const model = {
    profile,
    failed,
    baseUrl: __ENV.API_BASE_URL || 'https://api.practicesoftwaretesting.com',
    p95: num(metrics.http_req_duration, 'p(95)'),
    p99: num(metrics.http_req_duration, 'p(99)'),
    failRate: num(metrics.http_req_failed, 'rate'),
    checkRate: num(metrics.checks, 'rate'),
    iterations: num(metrics.iterations, 'count'),
    httpReqs: num(metrics.http_reqs, 'count'),
    vus: num(metrics.vus_max, 'value') || num(metrics.vus_max, 'max') || __ENV.VUS || '—',
    duration: durationMs != null ? `${(durationMs / 1000).toFixed(1)} s` : __ENV.DURATION || '—',
    generatedAt: new Date().toISOString(),
    slaP95: `${slaP95Ms} ms`,
    checks,
    endpoints,
    thresholds: rows,
  };

  const stdout = [
    `     profile: ${model.profile}`,
    `         p95: ${fmtMs(model.p95)}`,
    `         p99: ${fmtMs(model.p99)}`,
    `  error rate: ${fmtPct(model.failRate)}`,
    `      checks: ${fmtPct(model.checkRate)}`,
    `  thresholds: ${failed ? 'FAILED' : 'PASSED'}`,
    ...model.endpoints.map((e) => `    ${e.name}: n=${fmtCount(e.count)} p95=${fmtMs(e.p95)} fail=${fmtPct(e.failRate)} ${e.ok ? 'PASS' : 'FAIL'}`),
    ...rows.map((row) => `    ${row.ok ? 'ok  ' : 'FAIL'} ${row.metric}: ${row.rule} (actual ${row.actual})`),
  ].join('\n') + '\n';

  return {
    stdout,
    [`reports/k6/${profile}.html`]: renderHtml(model),
    [`reports/k6/${profile}.json`]: JSON.stringify(model, null, 2),
  };
}
