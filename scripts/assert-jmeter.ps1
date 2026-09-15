param(
  [Parameter(Mandatory = $true)]
  [string]$JtlPath,
  [string]$Profile = 'load',
  [double]$MaxErrorRate = 0.05,
  [int]$MaxP95Ms = 3000,
  [string]$OutHtml = ''
)

if (-not (Test-Path $JtlPath)) {
  throw "JTL not found: $JtlPath"
}

$rows = @(Import-Csv -Path $JtlPath)
if ($rows.Count -lt 1) {
  throw "JTL has no samples: $JtlPath"
}

function Get-Percentile {
  param([int[]]$Sorted, [double]$P)
  if ($Sorted.Count -eq 0) { return $null }
  $index = [Math]::Min($Sorted.Count - 1, [Math]::Max(0, [int][Math]::Ceiling($P * $Sorted.Count) - 1))
  return $Sorted[$index]
}

function Get-ConnectMs {
  param($Row)
  $raw = $Row.Connect
  if ($null -eq $raw -or $raw -eq '') { return 0 }
  return [Math]::Max(0, [int]$raw)
}

function Get-AppMs {
  param($Row)
  $elapsed = [int]$Row.elapsed
  $connect = Get-ConnectMs $Row
  return [Math]::Max(0, $elapsed - $connect)
}

$elapsed = @($rows | ForEach-Object { [int]$_.elapsed })
$app = @($rows | ForEach-Object { Get-AppMs $_ })
$sortedElapsed = @($elapsed | Sort-Object)
$sortedApp = @($app | Sort-Object)
$n = $elapsed.Count
$failures = @($rows | Where-Object { $_.success -ne 'true' }).Count
$wallP95 = Get-Percentile -Sorted $sortedElapsed -P 0.95
$wallP99 = Get-Percentile -Sorted $sortedElapsed -P 0.99
$p95 = Get-Percentile -Sorted $sortedApp -P 0.95
$p99 = Get-Percentile -Sorted $sortedApp -P 0.99
$avg = [int](($app | Measure-Object -Average).Average)
$min = $sortedApp[0]
$max = $sortedApp[-1]
$wallMax = $sortedElapsed[-1]
$errorRate = $failures / $n
$failed = ($errorRate -ge $MaxErrorRate) -or ($p95 -ge $MaxP95Ms)

$slowConnects = @($rows | Where-Object { (Get-ConnectMs $_) -ge 1000 } | ForEach-Object {
  [pscustomobject]@{
    Label   = $_.label
    Elapsed = [int]$_.elapsed
    Connect = Get-ConnectMs $_
    App     = Get-AppMs $_
  }
})

$labelOrder = @(
  'POST /users/register',
  'POST /users/login',
  'GET /products',
  'POST /carts',
  'POST /carts/:id',
  'GET /carts/:id',
  'DELETE /carts/:id'
)

$byLabel = $rows | Group-Object label
$labelStats = @()
function Add-LabelStats {
  param($Name, $GroupRows)
  $times = @($GroupRows | ForEach-Object { Get-AppMs $_ } | Sort-Object)
  $connects = @($GroupRows | ForEach-Object { Get-ConnectMs $_ })
  $fails = @($GroupRows | Where-Object { $_.success -ne 'true' }).Count
  $script:labelStats += [pscustomobject]@{
    Name       = $Name
    Count      = $times.Count
    Min        = $times[0]
    Avg        = [int](($times | Measure-Object -Average).Average)
    P95        = Get-Percentile -Sorted $times -P 0.95
    P99        = Get-Percentile -Sorted $times -P 0.99
    Max        = $times[-1]
    ConnectMax = ($connects | Measure-Object -Maximum).Maximum
    FailRate   = $fails / $times.Count
    Ok         = ($fails -eq 0) -and ((Get-Percentile -Sorted $times -P 0.95) -lt $MaxP95Ms)
  }
}

foreach ($name in $labelOrder) {
  $group = $byLabel | Where-Object { $_.Name -eq $name }
  if ($group) { Add-LabelStats $name $group.Group }
}
foreach ($group in $byLabel) {
  if ($labelOrder -contains $group.Name) { continue }
  Add-LabelStats $group.Name $group.Group
}

$maxBar = [Math]::Max(1, ($labelStats | Measure-Object P95 -Maximum).Maximum)
$stepHtml = ($labelStats | ForEach-Object {
  $i = [array]::IndexOf(@($labelStats | ForEach-Object { $_.Name }), $_.Name) + 1
  "<div class='step'><div class='n'>Step $i</div><div class='t'>$($_.Name)</div><div>$($_.Count) calls, $($_.P95) ms p95</div></div>"
}) -join ''
$barHtml = ($labelStats | ForEach-Object {
  $width = [Math]::Max(4, [int](($_.P95 / $maxBar) * 100))
  $cls = if (-not $_.Ok) { 'bad' } else { '' }
  "<div class='bar-row'><div class='bar-label'>$($_.Name)</div><div class='bar-track'><span class='bar-fill $cls' style='width:${width}%'></span></div><div class='bar-value'>$($_.P95) ms</div></div>"
}) -join ''
$rowHtml = ($labelStats | ForEach-Object {
  $okClass = if ($_.Ok) { 'pass' } else { 'fail' }
  $failPct = '{0:N2}%' -f ($_.FailRate * 100)
  $result = if ($_.Ok) { 'PASS' } else { 'FAIL' }
  "<tr><td><code>$($_.Name)</code></td><td>$($_.Count)</td><td>$($_.Min) ms</td><td>$($_.Avg) ms</td><td><strong>$($_.P95) ms</strong></td><td>$($_.P99) ms</td><td>$($_.Max) ms</td><td>$($_.ConnectMax) ms</td><td class='$okClass'>$failPct</td><td class='$okClass'>$result</td></tr>"
}) -join ''

$slowHtml = ''
if ($slowConnects.Count -gt 0) {
  $slowRows = ($slowConnects | ForEach-Object {
    "<tr><td><code>$($_.Label)</code></td><td>$($_.Elapsed) ms</td><td>$($_.Connect) ms</td><td>$($_.App) ms</td></tr>"
  }) -join ''
  $slowHtml = @"
    <section class="card" style="margin-bottom:18px;">
      <h2>TLS / connect outliers</h2>
      <p style="color:#5b6777;font-size:13px;margin:0 0 10px;">JMeter elapsed includes TCP+TLS. These samples were slow because connect was over 1s. SLA uses application time (elapsed minus connect), which matches k6 http_req_duration.</p>
      <table>
        <thead><tr><th>Request</th><th>Elapsed</th><th>Connect</th><th>Application</th></tr></thead>
        <tbody>$slowRows</tbody>
      </table>
    </section>
"@
}

if (-not $OutHtml) {
  $OutHtml = Join-Path (Split-Path $JtlPath -Parent) "$Profile-thresholds.html"
}

$status = if ($failed) { 'Thresholds failed' } else { 'Thresholds passed' }
$class = if ($failed) { 'fail' } else { 'pass' }
$errPct = '{0:N2}%' -f ($errorRate * 100)
$slaErr = '{0:N0}%' -f ($MaxErrorRate * 100)
$errOk = if ($errorRate -lt $MaxErrorRate) { 'PASS' } else { 'FAIL' }
$p95Ok = if ($p95 -lt $MaxP95Ms) { 'PASS' } else { 'FAIL' }
$errClass = if ($errorRate -lt $MaxErrorRate) { 'pass' } else { 'fail' }
$p95Class = if ($p95 -lt $MaxP95Ms) { 'pass' } else { 'fail' }
$generated = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Toolshop API - JMeter $Profile</title>
  <style>
    :root { --navy:#0f2744; --accent:#2f6fed; --ok:#0f7b4c; --bad:#c62828; --bg:#f3f5f8; --card:#fff; --line:#e4e8ee; --muted:#5b6777; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Segoe UI, system-ui, sans-serif; background: var(--bg); color: #1b2430; }
    .hero { background: linear-gradient(135deg, var(--navy), #1c4f8f); color: #fff; padding: 28px 32px 24px; }
    .hero h1 { margin: 0 0 6px; font-size: 26px; font-weight: 650; }
    .hero p { margin: 0; opacity: 0.88; }
    .badge { display: inline-block; margin-top: 12px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; background: #d9f5e5; color: var(--ok); }
    .badge.fail { background: #fde2e2; color: var(--bad); }
    .wrap { max-width: 1100px; margin: -18px auto 40px; padding: 0 20px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; box-shadow: 0 1px 2px rgba(15,39,68,0.04); }
    .kpi .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
    h2 { margin: 8px 0 12px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); border-bottom: 1px solid var(--line); padding: 8px 6px; }
    td { border-bottom: 1px solid var(--line); padding: 9px 6px; }
    code { font-family: Consolas, ui-monospace, monospace; font-size: 12px; }
    .pass { color: var(--ok); font-weight: 700; }
    .fail { color: var(--bad); font-weight: 700; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; color: var(--muted); font-size: 13px; }
    .meta b { color: #1b2430; }
    .bar-row { display: grid; grid-template-columns: 220px 1fr 80px; gap: 10px; align-items: center; margin: 8px 0; font-size: 13px; }
    .bar-track { height: 10px; background: #e8edf4; border-radius: 99px; overflow: hidden; }
    .bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
    .bar-fill.bad { background: var(--bad); }
    .bar-value { text-align: right; }
    .journey { display: flex; flex-wrap: wrap; gap: 8px; }
    .step { flex: 1 1 140px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: #fbfcfe; }
    .step .n { font-size: 11px; color: var(--muted); }
    .step .t { font-size: 12px; font-weight: 650; margin: 4px 0; }
    footer { margin-top: 18px; color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <header class="hero">
    <h1>Toolshop API performance</h1>
    <p>Custom SLA summary - not the official JMeter dashboard</p>
    <span class="badge $class">$status</span>
  </header>
  <div class="wrap">
    <section class="card" style="margin-bottom:18px;border-color:#2f6fed;">
      <h2>Official JMeter report</h2>
      <p style="margin:0;color:#5b6777;font-size:14px;">This page is our pass/fail summary (same layout as k6). JMeter's built-in HTML dashboard is APDEX, graphs, and over-time charts: <a href="${Profile}/index.html">open $Profile/index.html</a></p>
    </section>
    <section class="kpis">
      <div class="card kpi"><div class="label">p95 application</div><div class="value">${p95} ms</div></div>
      <div class="card kpi"><div class="label">p95 including TLS</div><div class="value">${wallP95} ms</div></div>
      <div class="card kpi"><div class="label">HTTP errors</div><div class="value">$errPct</div></div>
      <div class="card kpi"><div class="label">Samples</div><div class="value">$n</div></div>
    </section>
    <section class="card" style="margin-bottom:18px;">
      <h2>Run configuration</h2>
      <div class="meta">
        <div>Target <b>https://api.practicesoftwaretesting.com</b></div>
        <div>Profile <b>$Profile</b></div>
        <div>Application min / avg / max <b>${min} / ${avg} / ${max} ms</b></div>
        <div>Wall-clock max (includes TLS) <b>${wallMax} ms</b></div>
        <div>Generated <b>$generated</b></div>
        <div>SLA <b>errors &lt; $slaErr, application p95 &lt; ${MaxP95Ms} ms</b></div>
        <div>Full dashboard <b>reports/jmeter/${Profile}/index.html</b></div>
        <div>p99 application / including TLS <b>${p99} / ${wallP99} ms</b></div>
      </div>
    </section>
    <section class="card" style="margin-bottom:18px;">
      <h2>Authenticated journey</h2>
      <div class="journey">$stepHtml</div>
    </section>
    <section class="card" style="margin-bottom:18px;">
      <h2>Application latency by endpoint (p95, excludes connect)</h2>
      $barHtml
    </section>
    <section class="card" style="margin-bottom:18px;">
      <h2>Endpoint metrics</h2>
      <table>
        <thead><tr><th>Request</th><th>Count</th><th>Min</th><th>Avg</th><th>p95</th><th>p99</th><th>Max</th><th>Connect max</th><th>Fail</th><th>vs SLA</th></tr></thead>
        <tbody>$rowHtml</tbody>
      </table>
    </section>
    $slowHtml
    <section class="card">
      <h2>SLA thresholds</h2>
      <table>
        <thead><tr><th>Metric</th><th>Rule</th><th>Actual</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td><code>error rate</code></td><td>&lt; $slaErr</td><td>$errPct</td><td class="$errClass">$errOk</td></tr>
          <tr><td><code>application p95</code></td><td>&lt; ${MaxP95Ms} ms</td><td>${p95} ms</td><td class="$p95Class">$p95Ok</td></tr>
        </tbody>
      </table>
    </section>
    <footer>Agency performance template. Application time is elapsed minus TCP/TLS connect, so it is comparable to k6 http_req_duration. Open the JMeter HTML dashboard for charts.</footer>
  </div>
</body>
</html>
"@
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($OutHtml, $html, $utf8)

Write-Host "JMeter $Profile samples=$n errorRate=$errPct appP95=${p95}ms wallP95=${wallP95}ms -> $status"
Write-Host "Official JMeter dashboard: reports\jmeter\$Profile\index.html"
Write-Host "Custom SLA summary: $OutHtml"
if ($failed) {
  exit 1
}
