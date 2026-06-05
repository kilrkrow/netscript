<#
  capture-unifi.ps1 - pull UniFi Network controller JSON for NetScript.
  Run on a machine that can REACH the console (your LAN). Local read-only account.
  Windows PowerShell 5.1 AND PowerShell 7. Self-signed certs trusted once (below).

  Mirrors the proven auth flow in kilrkrow/UniFiHUD (UniFiApiService.cs):
    - login payload includes rememberMe + strict:false, tries /api/auth/login then /api/login
    - captures the CSRF token and sends X-Csrf-Token on every GET (required on https session auth)

    .\capture-unifi.ps1 -Controller https://192.168.1.1 -User ro -Pass 'secret'
    powershell -ExecutionPolicy Bypass -File .\capture-unifi.ps1 -Controller https://192.168.1.1 -User ro -Pass 'secret'

  Scrub MAC/IP before sharing if you like - the adapter only needs the SHAPE.
#>
param(
  [Parameter(Mandatory = $true)][string]$Controller,
  [Parameter(Mandatory = $true)][string]$User,
  [Parameter(Mandatory = $true)][string]$Pass,
  [string]$Site = "",
  [string]$Out  = "unifi-capture"
)

$ErrorActionPreference = "Stop"
$base = $Controller.TrimEnd("/")

# --- trust self-signed cert ONCE, for every request below (no per-Invoke flags) ---
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$common = @{ UseBasicParsing = $true }
if ($PSVersionTable.PSVersion.Major -ge 6) { $common.SkipCertificateCheck = $true }
else { [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } }

function Get-CsrfFromCookie($session, $uriStr) {
  try {
    $tok = ($session.Cookies.GetCookies([Uri]$uriStr) | Where-Object { $_.Name -eq 'TOKEN' }).Value
    if (-not $tok) { return $null }
    $p = $tok.Split('.')[1].Replace('-', '+').Replace('_', '/')
    switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
    return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json).csrfToken
  } catch { return $null }
}

# 1) log in (matches UniFiHUD: rememberMe+strict, try modern then legacy path, reject rc:error)
$body = @{ username = $User; password = $Pass; rememberMe = $true; strict = $false } | ConvertTo-Json
$loginResp = $null; $ok = $false
foreach ($path in @("/api/auth/login", "/api/login")) {
  try {
    $loginResp = Invoke-WebRequest -Uri "$base$path" -Method Post -Body $body `
      -ContentType "application/json" -SessionVariable sess @common
    if ($loginResp.StatusCode -lt 300 -and $loginResp.Content -notmatch '"rc"\s*:\s*"error"') { $ok = $true; break }
  } catch { }
}
if (-not $ok) {
  Write-Host "login failed (check host/creds; is this the right console?)." -ForegroundColor Red
  exit 1
}

# 2) capture CSRF token (header, else login JSON, else decode the TOKEN cookie JWT)
$csrf = $null
foreach ($h in @("X-CSRF-Token", "X-Csrf-Token")) { if ($loginResp.Headers.ContainsKey($h)) { $csrf = $loginResp.Headers[$h]; break } }
if (-not $csrf) { try { $j = $loginResp.Content | ConvertFrom-Json; $csrf = $j.csrfToken; if (-not $csrf) { $csrf = $j.data.csrfToken } } catch { } }
if (-not $csrf) { $csrf = Get-CsrfFromCookie $sess $base }
$headers = @{}; if ($csrf) { $headers["X-Csrf-Token"] = $csrf }

# 3) resolve site (default for session auth, like UniFiHUD; try discovery as a bonus)
if (-not $Site) {
  try {
    $s = Invoke-RestMethod -Uri "$base/proxy/network/api/self/sites" -WebSession $sess -Headers $headers @common
    if ($s.data -and $s.data[0].name) { $Site = $s.data[0].name }
  } catch { }
}
if (-not $Site) { $Site = "default" }

# 4) dump the endpoints the adapter needs (raw JSON, exact shape)
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$eps = @("stat/device", "stat/sta", "rest/networkconf", "rest/portconf")
foreach ($ep in $eps) {
  $file = Join-Path $Out ("unifi-" + ($ep -replace "/", "-") + ".json")
  try {
    $r = Invoke-WebRequest -Uri "$base/proxy/network/api/s/$Site/$ep" -WebSession $sess -Headers $headers @common
    [System.IO.File]::WriteAllText($file, $r.Content)
    Write-Host ("ok  {0,-18} -> {1}" -f $ep, $file)
  } catch {
    Write-Host ("ERR {0,-18} ({1})" -f $ep, $_.Exception.Message) -ForegroundColor Yellow
  }
}
Write-Host ""
Write-Host ("site=`"{0}`"  csrf={1}. Files in {2}\ - share them here (scrub MAC/IP if you want)." -f $Site, $(if ($csrf) { "yes" } else { "none" }), $Out)
