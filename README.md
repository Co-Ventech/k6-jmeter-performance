# K6 + JMeter performance

[Toolshop API](https://api.practicesoftwaretesting.com/api/documentation). Both tools run the same authenticated journey.

| Tool | What it shows |
|---|---|
| K6 | Load / stress / spike, thresholds, custom HTML report |
| JMeter | Same journey in `jmeter/toolshop.jmx`, official HTML dashboard + SLA page |

## Journey

1. `POST /users/register` — unique account
2. `POST /users/login` — Bearer token
3. `GET /products?page=1`
4. `POST /carts` → add item → get cart → delete cart

## Setup

Java 17+, [k6](https://k6.io/), Apache JMeter 5.6.3.

## Run

From this folder:

```powershell
k6 run k6/load.js
k6 run k6/stress.js
k6 run k6/spike.js
k6 run -e FAIL_DEMO=1 -e PROFILE=fail-demo k6/load.js

powershell -File scripts/run-jmeter.ps1 -Profile load
powershell -File scripts/run-jmeter.ps1 -Profile stress
powershell -File scripts/run-jmeter.ps1 -Profile spike
powershell -File scripts/run-jmeter.ps1 -Profile fail-demo
```

Or `npm run k6:load` / `npm run jmeter:load`. Fail-demo is supposed to exit 1.

Default SLA: error rate &lt; 5%, p95 &lt; 3000 ms. Other API:

```powershell
k6 run -e API_BASE_URL=https://api.practicesoftwaretesting.com k6/load.js
$env:API_BASE_URL="https://api.practicesoftwaretesting.com"
```

## Reports

```powershell
start reports\index.html
```

| Report | Path |
|---|---|
| K6 HTML | `reports/k6/load.html` |
| JMeter dashboard (graphs) | `reports/jmeter/load/index.html` |
| JMeter SLA (same layout as k6) | `reports/jmeter/load-thresholds.html` |

Use `stress`, `spike`, or `fail-demo` in the path for those profiles. If a JMeter page looks like k6, you opened the SLA file, not the dashboard.

## CI

GitHub Actions runs a light k6 load (`2` VUs, `20s`) and the same JMeter load profile, then uploads `reports/` as the `performance-reports` artifact.

## Layout

```
k6/                 scripts + HTML summary
jmeter/toolshop.jmx same journey
scripts/            JMeter runner + SLA check
reports/            landing page; generated output is gitignored
```
