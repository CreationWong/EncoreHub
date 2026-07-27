# EncoreHub build script — Windows PowerShell
# Usage: .\scripts\build.ps1 [-SkipEngine] [-SkipGateway] [-SkipFrontend] [-Debug] [-Tauri] [-Parallel] [-SkipInstall]
#
# Examples:
#   .\scripts\build.ps1                        # full release build (no installer)
#   .\scripts\build.ps1 -Debug                 # debug build (fast iteration)
#   .\scripts\build.ps1 -Tauri                 # release + desktop installer (.msi + .exe)
#   .\scripts\build.ps1 -Parallel              # build engine + gateway concurrently
#   .\scripts\build.ps1 -SkipEngine -SkipGateway  # frontend only
#   .\scripts\build.ps1 -SkipInstall           # skip pnpm install (offline / pre-installed)

param(
    [switch]$SkipEngine,
    [switch]$SkipGateway,
    [switch]$SkipFrontend,
    [switch]$Debug,
    [switch]$Tauri,
    [switch]$Parallel,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path

# ---- profile / flags ----
$cargoProfile = if ($Debug) { "" } else { "--release" }
$cargoTarget  = if ($Debug) { "debug" } else { "release" }
$goBuildBase  = @("build", "-trimpath")
if (-not $Debug) { $goBuildBase += @("-ldflags", "-s -w") }
if ($Debug)     { $goBuildBase += @("-gcflags", "all=-N -l") }

$tauriCmd     = if ($Debug) { "dev" } else { "build" }
$binaryDir    = "$repoRoot\frontend\src-tauri\binaries"
$engineSrc    = "$repoRoot\engine\target\$cargoTarget\encorehub-engine.exe"
$gatewaySrc   = "$repoRoot\gateway\bin\encorehub-gateway.exe"

# ---- helpers ----
$timings = [ordered]@{}
function Write-Step($msg) {
    Write-Host "`n$([char]0x2500) $msg $([char]0x2500)" -ForegroundColor Cyan
}
function Write-Ok($msg)  { Write-Host "    $([char]0x2714) $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $([char]0x26A0) $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "    $([char]0x2718) $msg" -ForegroundColor Red; exit 1 }

function Step($name, $script) {
    Write-Step $name
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        & $script
        $sw.Stop()
        $timings[$name] = $sw.Elapsed
        Write-Ok "$name done ($($sw.Elapsed.ToString('s\.ff')))"
    } catch {
        $sw.Stop()
        $timings[$name] = $sw.Elapsed
        Write-Err "$name FAILED ($($sw.Elapsed.ToString('s\.ff')))$([Environment]::NewLine)  $($_.Exception.Message)"
    }
}

# ---- preflight ----
Write-Step "Prerequisites"
$tools = @(
    @{Name="node";  Skip=$false;       Cmd="node --version"},
    @{Name="pnpm";  Skip=$false;       Cmd="pnpm --version"},
    @{Name="go";    Skip=$SkipGateway; Cmd="go version"},
    @{Name="cargo"; Skip=$SkipEngine;  Cmd="cargo --version"}
)
foreach ($t in $tools) {
    try {
        $null = & cmd /c "$($t.Cmd) 2>nul"
        if ($LASTEXITCODE -eq 0) { Write-Ok $t.Name } else { throw }
    } catch {
        if ($t.Skip) {
            Write-Warn "$($t.Name) skipped (build disabled)"
        } else {
            Write-Err "$($t.Name) not found in PATH"
        }
    }
}

# ---- build steps (defined as functions so they can be timed) ----

function Build-Engine {
    if ($Tauri) {
        Write-Warn "engine is NOT a Tauri sidecar; cargo check lib only"
        Push-Location "$repoRoot\engine"
        try {
            $args = @("check")
            if (-not $Debug) { $args += "--release" }
            cargo @args
            if ($LASTEXITCODE -ne 0) { throw "cargo check failed" }
            Write-Ok "engine lib checked (in-process for Tauri)"
        } finally { Pop-Location }
    } else {
        Push-Location "$repoRoot\engine"
        try {
            $args = @("build", "--features", "standalone")
            if (-not $Debug) { $args += "--release" }
            cargo @args
            if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
            if (Test-Path $engineSrc) {
                $sz = [math]::Round((Get-Item $engineSrc).Length / 1MB, 1)
                Write-Ok "engine built ($sz MB)"
            } else {
                Write-Ok "engine built"
            }
        } finally { Pop-Location }
    }
}

function Build-Gateway {
    Push-Location "$repoRoot\gateway"
    try {
        New-Item -ItemType Directory -Force -Path bin | Out-Null
        $args = $goBuildBase + @("-o", "bin\encorehub-gateway.exe", ".\cmd\gateway")
        go @args
        if ($LASTEXITCODE -ne 0) { throw "go build failed" }
        if (Test-Path $gatewaySrc) {
            $sz = [math]::Round((Get-Item $gatewaySrc).Length / 1MB, 1)
            Write-Ok "gateway built ($sz MB)"
        } else {
            Write-Ok "gateway built"
        }
    } finally { Pop-Location }
}

function Build-Frontend {
    Push-Location "$repoRoot\frontend"
    try {
        if (-not $SkipInstall) {
            pnpm install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
        }
        if (-not $Tauri) {
            pnpm build
            if ($LASTEXITCODE -ne 0) { throw "pnpm build failed" }
        }
        if (Test-Path "$repoRoot\frontend\dist\index.html") {
            Write-Ok "frontend built (dist/ ready)"
        } else {
            Write-Ok "frontend prepared (Tauri will build internally)"
        }
    } finally { Pop-Location }
}

# ---- execute (parallel or sequential) ----
if ($Parallel -and -not $SkipEngine -and -not $SkipGateway) {
    $jobE = Start-Job -Name "engine"  -ScriptBlock ${function:Build-Engine}
    $jobG = Start-Job -Name "gateway" -ScriptBlock ${function:Build-Gateway}
    # Wait for both, but track completion in order for timing
    $null = Wait-Job -Job $jobE, $jobG
    foreach ($j in $jobE, $jobG) {
        $out = Receive-Job -Job $j
        if ($out) { $out | ForEach-Object { Write-Host $_ } }
        $state = $j.State
        if ($state -eq "Failed") { Write-Err "$($j.Name) FAILED"; Remove-Job -Job $j; exit 1 }
        Write-Ok "$($j.Name) done ($state)"
        Remove-Job -Job $j
    }
    if (-not $SkipFrontend) { Step "frontend" { Build-Frontend } }
} else {
    if (-not $SkipEngine)   { Step "engine"   { Build-Engine } }
    if (-not $SkipGateway)  { Step "gateway"  { Build-Gateway } }
    if (-not $SkipFrontend) { Step "frontend" { Build-Frontend } }
}

# ---- copy gateway sidecar + Tauri bundle ----
if ($Tauri) {
    Write-Step "Tauri external binaries"
    New-Item -ItemType Directory -Force -Path $binaryDir | Out-Null

    $triple = (rustc -vV | Select-String '^host:\s*(.+)$').Matches.Groups[1].Value.Trim()
    Write-Ok "host target triple: $triple"

    # Only gateway is a Tauri sidecar now — engine runs in-process.
    if (Test-Path $gatewaySrc) {
        Copy-Item -Force $gatewaySrc "$binaryDir\encorehub-gateway.exe"
        Copy-Item -Force $gatewaySrc "$binaryDir\encorehub-gateway-$triple.exe"
        $sz = [math]::Round((Get-Item $gatewaySrc).Length / 1MB, 1)
        Write-Ok "encorehub-gateway.exe → binaries/ ($sz MB, also $triple alias)"
    } else {
        Write-Warn "encorehub-gateway.exe not found — Tauri may use a stale cached binary"
    }

    Step "tauri-installer" {
        Push-Location "$repoRoot\frontend"
        try {
            pnpm tauri $tauriCmd
            if ($LASTEXITCODE -ne 0) { throw "tauri $tauriCmd failed" }
            Write-Ok "Tauri installer generated"
        } finally { Pop-Location }
    }
}

# ---- summary ----
Write-Host "`n$('=' * 50)" -ForegroundColor Green
Write-Host "  Build complete" -ForegroundColor Green
Write-Host "$('=' * 50)" -ForegroundColor Green
foreach ($k in $timings.Keys) {
    $s = [math]::Round($timings[$k].TotalSeconds, 1)
    Write-Host ("  {0,-20} {1,6}s" -f $k, $s)
}
Write-Host "$('=' * 50)" -ForegroundColor Green

if ($Tauri) {
    Write-Host "`n  MSI:   $repoRoot\frontend\src-tauri\target\release\bundle\msi"
    Write-Host "  NSIS:  $repoRoot\frontend\src-tauri\target\release\bundle\nsis`n"
}
