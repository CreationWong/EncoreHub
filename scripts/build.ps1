# EncoreHub build script — Windows PowerShell
# Usage: .\scripts\build.ps1 [--skip-engine] [--skip-gateway] [--skip-frontend] [--debug] [--tauri]
#
# Examples:
#   .\scripts\build.ps1                        # full release build (no installer)
#   .\scripts\build.ps1 -Debug                 # debug build
#   .\scripts\build.ps1 -Tauri                 # release + desktop installer (.msi + .exe)
#   .\scripts\build.ps1 -SkipEngine -SkipGateway  # frontend only

param(
    [switch]$SkipEngine,
    [switch]$SkipGateway,
    [switch]$SkipFrontend,
    [switch]$Debug,
    [switch]$Tauri
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path

$cargoProfile = if ($Debug) { "" } else { "--release" }
$cargoTarget  = if ($Debug) { "debug" } else { "release" }
$goBuildArgs  = if ($Debug) { @("-gcflags", "all=-N -l") } else { @("-ldflags", "-s -w") }
$tauriArgs     = if ($Debug) { @("tauri", "dev") } else { @("tauri", "build") }

$binaryDir    = "$repoRoot\frontend\src-tauri\binaries"
$engineSrc    = "$repoRoot\engine\target\$cargoTarget\encorehub-engine.exe"
$gatewaySrc   = "$repoRoot\gateway\bin\gateway.exe"

# ---------- helpers ----------
function Write-Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)  { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

# ---------- preflight ----------
Write-Step "Checking prerequisites"
@(
    @{Name="node";   Cmd="node --version"},
    @{Name="pnpm";   Cmd="pnpm --version"},
    @{Name="go";     Cmd="go version"},
    @{Name="cargo";  Cmd="cargo --version"}
) | ForEach-Object {
    $ok = $false
    try { $null = Invoke-Expression $_.Cmd 2>&1; $ok = ($LASTEXITCODE -eq 0) } catch { }
    if ($ok) { Write-Ok $_.Name } else { Write-Err "$($_.Name) not found" }
}

# ---------- engine ----------
if (-not $SkipEngine) {
    Write-Step "Building engine (Rust)"
    Push-Location "$repoRoot\engine"
    try {
        $args = @("build")
        if (-not $Debug) { $args += "--release" }
        cargo @args
        if ($LASTEXITCODE -ne 0) { Write-Err "engine build failed" }
        Write-Ok "engine built"
    } finally { Pop-Location }
}

# ---------- gateway ----------
if (-not $SkipGateway) {
    Write-Step "Building gateway (Go)"
    Push-Location "$repoRoot\gateway"
    try {
        New-Item -ItemType Directory -Force -Path bin | Out-Null
        $args = @("build") + $goBuildArgs + @("-o", "bin\gateway.exe", ".\cmd\gateway")
        go @args
        if ($LASTEXITCODE -ne 0) { Write-Err "gateway build failed" }
        Write-Ok "gateway built"
    } finally { Pop-Location }
}

# ---------- frontend ----------
if (-not $SkipFrontend) {
    Write-Step "Building frontend (TypeScript + Vite)"
    Push-Location "$repoRoot\frontend"
    try {
        pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { Write-Err "pnpm install failed" }

        if ($Tauri) {
            # Tauri build also runs tsc+vite internally via beforeBuildCommand
        } else {
            pnpm build
            if ($LASTEXITCODE -ne 0) { Write-Err "frontend build failed" }
        }
        Write-Ok "frontend built"
    } finally { Pop-Location }
}

# ---------- copy binaries for Tauri ----------
if ($Tauri) {
    Write-Step "Preparing external binaries for Tauri"
    New-Item -ItemType Directory -Force -Path $binaryDir | Out-Null

    # Tauri's externalBin resolves each entry to a target-triple-suffixed name
    # at bundle time (e.g. encorehub-engine-x86_64-pc-windows-msvc.exe) and does
    # NOT strip the triple. We must place the binary under that exact name, or
    # Tauri bundles a stale copy. We write both the plain and triple-suffixed
    # names so a `tauri dev` (plain) and `tauri build` (triple) both pick up the
    # fresh binary.
    $triple = (rustc -vV | Select-String '^host:\s*(.+)$').Matches.Groups[1].Value.Trim()
    Write-Ok "host target triple: $triple"

    function Copy-Sidecar($src, $name) {
        if (Test-Path $src) {
            Copy-Item -Force $src "$binaryDir\$name.exe"
            Copy-Item -Force $src "$binaryDir\$name-$triple.exe"
            Write-Ok "copied $name.exe (+ $name-$triple.exe)"
        } else {
            Write-Host "  ⚠ $name binary not found at $src, continuing" -ForegroundColor Yellow
        }
    }

    Copy-Sidecar $engineSrc  "encorehub-engine"
    Copy-Sidecar $gatewaySrc "gateway"

    # ---------- Tauri bundle ----------
    Write-Step "Building Tauri desktop installer"
    Push-Location "$repoRoot\frontend"
    try {
        pnpm tauri build
        if ($LASTEXITCODE -ne 0) { Write-Err "tauri build failed" }
        Write-Ok "Tauri installer generated"
    } finally { Pop-Location }
}

Write-Host "`n=== Build complete ===" -ForegroundColor Green
if ($Tauri) {
    Write-Host "  MSI:   $repoRoot\frontend\src-tauri\target\release\bundle\msi"
    Write-Host "  NSIS:  $repoRoot\frontend\src-tauri\target\release\bundle\nsis"
}
