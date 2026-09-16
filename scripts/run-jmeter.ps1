param(
  [ValidateSet('load', 'stress', 'spike', 'fail-demo')]
  [string]$Profile = 'load'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $env:JAVA_HOME) {
    $env:JAVA_HOME = [System.Environment]::GetEnvironmentVariable('JAVA_HOME', 'Machine')
  }
}

$isWindows = [bool]($IsWindows)
if (-not $isWindows -and $PSVersionTable.PSVersion.Major -lt 6) {
  $isWindows = $env:OS -eq 'Windows_NT'
}
$jmeterCmd = if ($isWindows) { 'jmeter.bat' } else { 'jmeter' }
$jmeter = Get-Command $jmeterCmd -ErrorAction SilentlyContinue
if (-not $jmeter -and $isWindows) {
  $jmeter = Get-Command jmeter -ErrorAction SilentlyContinue
}
$jmeterBat = $null
if ($jmeter) {
  $jmeterBat = $jmeter.Source
} else {
  $candidates = @(
    (Join-Path $env:JMETER_HOME 'bin/jmeter.bat'),
    (Join-Path $env:JMETER_HOME 'bin/jmeter'),
    'C:\Program Files\Apache\JMeter\bin\jmeter.bat',
    'C:\Program Files\jmeter\bin\jmeter.bat',
    (Join-Path $env:LOCALAPPDATA 'Programs\JMeter\bin\jmeter.bat'),
    (Join-Path $root '..\.tools\apache-jmeter-5.6.3\bin\jmeter.bat'),
    (Join-Path $root '..\.tools\apache-jmeter-5.6.3\bin\jmeter')
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path $path)) {
      $jmeterBat = (Resolve-Path $path).Path
      break
    }
  }
}

if (-not $jmeterBat) {
  throw "JMeter not found. Install it, set JMETER_HOME, or unpack Apache JMeter 5.6.3 under All-Frameworks\.tools\apache-jmeter-5.6.3"
}

$users = 5
$rampup = 10
$duration = 30
$maxP95 = 3000
switch ($Profile) {
  'stress' {
    $users = 8
    $rampup = 20
    $duration = 55
  }
  'spike' {
    $users = 12
    $rampup = 5
    $duration = 35
  }
  'fail-demo' {
    $users = 3
    $rampup = 3
    $duration = 20
    $maxP95 = 1
  }
}

if ($env:JMETER_USERS) { $users = [int]$env:JMETER_USERS }
if ($env:JMETER_RAMPUP) { $rampup = [int]$env:JMETER_RAMPUP }
if ($env:JMETER_DURATION) { $duration = [int]$env:JMETER_DURATION }

$hostName = 'api.practicesoftwaretesting.com'
if ($env:API_BASE_URL) {
  $uri = [Uri]$env:API_BASE_URL
  $hostName = $uri.Host
}

$outDir = Join-Path $root "reports\jmeter\$Profile"
$jtl = Join-Path $root "reports\jmeter\$Profile.jtl"
New-Item -ItemType Directory -Force -Path (Split-Path $jtl -Parent) | Out-Null
if (Test-Path $outDir) {
  Remove-Item -Recurse -Force $outDir
}
if (Test-Path $jtl) {
  Remove-Item -Force $jtl
}

Write-Host "Warming DNS for $hostName"
$warmed = $false
foreach ($i in 1..5) {
  try {
    Invoke-WebRequest -Uri "https://$hostName/products?page=1" -UseBasicParsing -TimeoutSec 20 | Out-Null
    $warmed = $true
    break
  } catch {
    Write-Host "Warmup attempt $i failed: $($_.Exception.Message)"
    Start-Sleep -Seconds 2
  }
}
if (-not $warmed) {
  Write-Host "Continuing without a successful warmup"
}

$jmx = Join-Path $root 'jmeter\toolshop.jmx'
$jmeterBin = Split-Path $jmeterBat -Parent
$jar = Join-Path $jmeterBin 'ApacheJMeter.jar'
$javaHomeBin = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin' } else { $null }
$javaExe = if ($javaHomeBin -and (Test-Path (Join-Path $javaHomeBin 'java.exe'))) {
  Join-Path $javaHomeBin 'java.exe'
} elseif ($javaHomeBin -and (Test-Path (Join-Path $javaHomeBin 'java'))) {
  Join-Path $javaHomeBin 'java'
} else {
  'java'
}
Write-Host "Running JMeter $Profile via $jar"
$prev = Get-Location
Set-Location $jmeterBin
try {
  & $javaExe -jar $jar -n -t $jmx -l $jtl -e -o $outDir "-Jusers=$users" "-Jrampup=$rampup" "-Jduration=$duration" "-Jhost=$hostName"
  $code = $LASTEXITCODE
} finally {
  Set-Location $prev
}
if ($code -ne 0) {
  exit $code
}

& (Join-Path $PSScriptRoot 'assert-jmeter.ps1') -JtlPath $jtl -Profile $Profile -MaxP95Ms $maxP95
exit $LASTEXITCODE
