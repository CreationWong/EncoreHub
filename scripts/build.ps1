# EncoreHub build workflow - Windows PowerShell
# Usage: .\scripts\build.ps1 [-SkipEngine] [-SkipGateway] [-SkipFrontend] [-Debug] [-Tauri] [-Parallel] [-SkipInstall] [-Components <names>]
#
# Examples:
#   .\scripts\build.ps1
#   .\scripts\build.ps1 -Debug
#   .\scripts\build.ps1 -Tauri
#   .\scripts\build.ps1 -Tauri -Debug
#   .\scripts\build.ps1 -Parallel
#   .\scripts\build.ps1 -SkipEngine -SkipGateway
#   .\scripts\build.ps1 -SkipInstall
#   .\scripts\build.ps1 -Components engine,gateway
#   .\scripts\build.ps1 -Components desktop

param(
    [switch]$SkipEngine,
    [switch]$SkipGateway,
    [switch]$SkipFrontend,
    [switch]$Debug,
    [switch]$Tauri,
    [switch]$Parallel,
    [switch]$SkipInstall,
    [string[]]$Components = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendDir = Join-Path $repoRoot "frontend"
$engineDir = Join-Path $repoRoot "engine"
$gatewayDir = Join-Path $repoRoot "gateway"
$cargoTarget = if ($Debug) { "debug" } else { "release" }
$binaryDir = Join-Path $frontendDir "src-tauri\binaries"
$engineSource = Join-Path $engineDir "target\$cargoTarget\encorehub-engine.exe"
$gatewaySource = Join-Path $gatewayDir "bin\encorehub-gateway.exe"
$timings = [ordered]@{}

if ($Components.Count -gt 0) {
    if ($Tauri -or $SkipEngine -or $SkipGateway -or $SkipFrontend -or $Parallel -or $SkipInstall) {
        throw "-Components cannot be combined with legacy build-selection switches"
    }
    $componentNames = @(
        $Components |
            ForEach-Object { $_ -split "," } |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    $componentArguments = @(
        (Join-Path $repoRoot "scripts\build-components.mjs"),
        "--components",
        ($componentNames -join ","),
        $(if ($Debug) { "--debug" } else { "--release" })
    )
    & node @componentArguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    exit 0
}

function Write-Section {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host ""
    Write-Host "-- $Message --" -ForegroundColor Cyan
}

function Write-Success {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "    [OK] $Message" -ForegroundColor Green
}

function Write-WarningMessage {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "    [WARN] $Message" -ForegroundColor Yellow
}

function Write-Failure {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "    [FAIL] $Message" -ForegroundColor Red
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)][string]$Command,
        [string[]]$Arguments = @()
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command exited with code $LASTEXITCODE"
    }
}

function Invoke-TimedStep {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Action
    )

    Write-Section $Name
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        & $Action
    } catch {
        $timer.Stop()
        $timings[$Name] = $timer.Elapsed
        throw "$Name failed after $(Format-Duration $timer.Elapsed): $($_.Exception.Message)"
    }

    $timer.Stop()
    $timings[$Name] = $timer.Elapsed
    Write-Success "$Name completed in $(Format-Duration $timer.Elapsed)"
}

function Test-Prerequisite {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][bool]$Required,
        [string[]]$VersionArguments = @("--version")
    )

    if (-not $Required) {
        return
    }

    try {
        $null = Get-Command $Name -ErrorAction Stop
        & $Name @VersionArguments *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "$Name version check exited with code $LASTEXITCODE"
        }
        Write-Success $Name
    } catch {
        throw "$Name is required but was not found in PATH"
    }
}

function Resolve-Protoc {
    param([Parameter(Mandatory)][bool]$Required)

    if (-not $Required) {
        return
    }

    $configured = [Environment]::GetEnvironmentVariable("PROTOC", "Process")
    if ($configured) {
        if (-not (Test-Path -LiteralPath $configured -PathType Leaf)) {
            throw "PROTOC points to a missing file: $configured"
        }
        & $configured --version *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "PROTOC version check exited with code $LASTEXITCODE"
        }
        $env:PROTOC = (Resolve-Path -LiteralPath $configured).Path
        Write-Success "protoc (PROTOC)"
        return
    }

    $systemProtoc = Get-Command "protoc" -CommandType Application -ErrorAction SilentlyContinue
    if ($systemProtoc) {
        $env:PROTOC = $systemProtoc.Source
        & $env:PROTOC --version *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "protoc version check exited with code $LASTEXITCODE"
        }
        Write-Success "protoc (PATH)"
        return
    }

    $resolverManifest = Join-Path $engineDir "crates\protoc-resolver\Cargo.toml"
    $resolverOutput = & cargo run --quiet --manifest-path $resolverManifest
    if ($LASTEXITCODE -ne 0) {
        throw "vendored protoc resolver exited with code $LASTEXITCODE"
    }
    $resolverLines = @(
        $resolverOutput |
            ForEach-Object { $_.ToString().Trim() } |
            Where-Object { $_ }
    )
    if ($resolverLines.Count -eq 0) {
        throw "vendored protoc resolver returned no executable path"
    }
    $resolved = $resolverLines[-1]
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "vendored protoc resolver returned a missing file: $resolved"
    }
    $env:PROTOC = (Resolve-Path -LiteralPath $resolved).Path
    & $env:PROTOC --version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "vendored protoc version check exited with code $LASTEXITCODE"
    }
    Write-Success "protoc (vendored)"
}

function Format-FileSize {
    param([Parameter(Mandatory)][long]$Bytes)
    return "{0:N1} MB" -f ($Bytes / 1MB)
}

function Format-Duration {
    param([Parameter(Mandatory)][TimeSpan]$Elapsed)
    $seconds = $Elapsed.TotalSeconds.ToString(
        "0.00",
        [Globalization.CultureInfo]::InvariantCulture
    )
    return $seconds + "s"
}

function Build-Engine {
    Push-Location $engineDir
    try {
        if ($Tauri) {
            $profileFlag = if ($Debug) { "--debug" } else { "--release" }
            Invoke-NativeCommand -Command "node" -Arguments @(
                (Join-Path $repoRoot "scripts\prepare-engine-runtime.mjs"),
                $profileFlag
            )
            Write-Success "engine runtime library prepared"
            return
        }

        $cargoArguments = @("build", "--features", "standalone")
        if (-not $Debug) {
            $cargoArguments += "--release"
        }
        Invoke-NativeCommand -Command "cargo" -Arguments $cargoArguments

        if (Test-Path -LiteralPath $engineSource) {
            Write-Success "engine built ($(Format-FileSize (Get-Item -LiteralPath $engineSource).Length))"
        } else {
            Write-Success "engine built"
        }
    } finally {
        Pop-Location
    }
}

function Build-Gateway {
    $profileFlag = if ($Debug) { "--debug" } else { "--release" }
    Invoke-NativeCommand -Command "node" -Arguments @(
        (Join-Path $repoRoot "scripts\prepare-gateway-sidecar.mjs"),
        $profileFlag
    )
    if (Test-Path -LiteralPath $gatewaySource) {
        Write-Success "gateway built ($(Format-FileSize (Get-Item -LiteralPath $gatewaySource).Length))"
    } else {
        throw "gateway command completed without producing $gatewaySource"
    }
}

function Build-Frontend {
    Push-Location $frontendDir
    try {
        if (-not $SkipInstall) {
            Invoke-NativeCommand -Command "pnpm" -Arguments @("install", "--frozen-lockfile")
        }

        if ($Tauri) {
            Write-Success "frontend dependencies ready; Tauri owns the Vite lifecycle"
            return
        }

        Invoke-NativeCommand -Command "pnpm" -Arguments @("build")
        $indexPath = Join-Path $frontendDir "dist\index.html"
        if (-not (Test-Path -LiteralPath $indexPath)) {
            throw "frontend build completed without producing dist\index.html"
        }
        Write-Success "frontend built (dist ready)"
    } finally {
        Pop-Location
    }
}

function Invoke-ParallelCoreBuilds {
    Write-Section "engine + gateway (parallel)"
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $jobs = @()
    $failure = $null

    try {
        $engineJobArguments = @($repoRoot, [bool]$Tauri, [bool]$Debug, $engineSource)
        $jobs += Start-Job -Name "encorehub-engine-build" -ArgumentList $engineJobArguments -ScriptBlock {
            param($Root, $UseTauri, $UseDebug, $EngineOutput)
            $ErrorActionPreference = "Stop"
            Set-Location (Join-Path $Root "engine")

            if ($UseTauri) {
                $profileFlag = if ($UseDebug) { "--debug" } else { "--release" }
                & node (Join-Path $Root "scripts\prepare-engine-runtime.mjs") $profileFlag
                if ($LASTEXITCODE -ne 0) {
                    throw "Engine Runtime build exited with code $LASTEXITCODE"
                }
                [pscustomobject]@{
                    EncoreHubBuildResult = $true
                    Component = "engine"
                    Operation = "prepared"
                    SizeBytes = 0
                }
            } else {
                $cargoArguments = @("build", "--features", "standalone")
                if (-not $UseDebug) {
                    $cargoArguments += "--release"
                }
                & cargo @cargoArguments
                if ($LASTEXITCODE -ne 0) {
                    throw "cargo build exited with code $LASTEXITCODE"
                }
                $sizeBytes = if (Test-Path -LiteralPath $EngineOutput) {
                    (Get-Item -LiteralPath $EngineOutput).Length
                } else {
                    0
                }
                [pscustomobject]@{
                    EncoreHubBuildResult = $true
                    Component = "engine"
                    Operation = "built"
                    SizeBytes = $sizeBytes
                }
            }
        }

        $gatewayJobArguments = @($repoRoot, [bool]$Debug, $gatewaySource)
        $jobs += Start-Job -Name "encorehub-gateway-build" -ArgumentList $gatewayJobArguments -ScriptBlock {
            param($Root, $UseDebug, $GatewayOutput)
            $ErrorActionPreference = "Stop"
            $profileFlag = if ($UseDebug) { "--debug" } else { "--release" }
            & node (Join-Path $Root "scripts\prepare-gateway-sidecar.mjs") $profileFlag
            if ($LASTEXITCODE -ne 0) {
                throw "Gateway build exited with code $LASTEXITCODE"
            }
            if (-not (Test-Path -LiteralPath $GatewayOutput)) {
                throw "gateway command completed without producing $GatewayOutput"
            }
            [pscustomobject]@{
                EncoreHubBuildResult = $true
                Component = "gateway"
                Operation = "built"
                SizeBytes = (Get-Item -LiteralPath $GatewayOutput).Length
            }
        }

        $null = Wait-Job -Job $jobs
        $results = @()
        foreach ($job in $jobs) {
            $receiveErrors = @()
            $jobOutput = @(
                Receive-Job -Job $job -ErrorVariable receiveErrors -ErrorAction SilentlyContinue
            )
            foreach ($item in $jobOutput) {
                if ($null -ne $item -and $null -ne $item.PSObject.Properties["EncoreHubBuildResult"]) {
                    $results += $item
                } else {
                    Write-Host $item
                }
            }

            if ($job.State -ne "Completed") {
                foreach ($errorRecord in $receiveErrors) {
                    Write-Host "    $($errorRecord.ToString())" -ForegroundColor Red
                }
                $reason = $job.JobStateInfo.Reason
                $detail = if ($null -ne $reason) { $reason.Message } else { $job.State }
                throw "$($job.Name) failed: $detail"
            }
        }

        foreach ($result in $results) {
            if ($result.Operation -eq "prepared") {
                Write-Success "$($result.Component) runtime library prepared"
            } elseif ([long]$result.SizeBytes -gt 0) {
                Write-Success "$($result.Component) built ($(Format-FileSize ([long]$result.SizeBytes)))"
            } else {
                Write-Success "$($result.Component) built"
            }
        }
    } catch {
        $failure = $_
    } finally {
        foreach ($job in $jobs) {
            if ($job.State -eq "Running") {
                Stop-Job -Job $job -ErrorAction SilentlyContinue
            }
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }

    $timer.Stop()
    $timings["engine + gateway"] = $timer.Elapsed
    if ($null -ne $failure) {
        throw "parallel core build failed after $(Format-Duration $timer.Elapsed): $($failure.Exception.Message)"
    }
    Write-Success "parallel core build completed in $(Format-Duration $timer.Elapsed)"
}

function Prepare-TauriSidecar {
    New-Item -ItemType Directory -Force -Path $binaryDir | Out-Null

    $runtimeLibrary = Join-Path $binaryDir "encorehub_desktop_runtime.dll"
    $runtimeManifest = Join-Path $binaryDir "engine-runtime.json"
    $gatewayManifest = Join-Path $binaryDir "gateway-runtime.json"
    if (-not (Test-Path -LiteralPath $runtimeLibrary) -or
        -not (Test-Path -LiteralPath $runtimeManifest)) {
        throw "Engine Runtime module is missing; build the engine component first"
    }
    Write-Success "engine runtime module ready ($(Format-FileSize (Get-Item -LiteralPath $runtimeLibrary).Length))"
    if (-not (Test-Path -LiteralPath $gatewayManifest)) {
        throw "Gateway module manifest is missing; build the gateway component first"
    }

    $rustcDetails = @(& rustc -vV)
    if ($LASTEXITCODE -ne 0) {
        throw "rustc -vV exited with code $LASTEXITCODE"
    }
    $hostLine = $rustcDetails | Where-Object { $_ -match "^host:\s*" } | Select-Object -First 1
    if ($null -eq $hostLine -or $hostLine -notmatch "^host:\s*(.+)$") {
        throw "could not determine the Rust host target triple"
    }
    $targetTriple = $Matches[1].Trim()
    Write-Success "host target triple: $targetTriple"

    if ($SkipGateway) {
        Write-WarningMessage "gateway build was skipped; using the existing binary when available"
    }
    if (-not (Test-Path -LiteralPath $gatewaySource)) {
        throw "gateway sidecar not found at $gatewaySource"
    }

    $plainSidecar = Join-Path $binaryDir "encorehub-gateway.exe"
    $targetSidecar = Join-Path $binaryDir "encorehub-gateway-$targetTriple.exe"
    Copy-Item -Force -LiteralPath $gatewaySource -Destination $plainSidecar
    Copy-Item -Force -LiteralPath $gatewaySource -Destination $targetSidecar
    $size = Format-FileSize (Get-Item -LiteralPath $gatewaySource).Length
    Write-Success "gateway sidecar copied ($size; target $targetTriple)"
}

function Start-TauriDevelopment {
    Write-Section "Tauri desktop development"
    Write-Host "    Development sessions are not timed. Press Ctrl+C to stop." -ForegroundColor Yellow
    Push-Location $frontendDir
    try {
        Invoke-NativeCommand -Command "pnpm" -Arguments @("tauri", "dev")
    } finally {
        Pop-Location
    }
}

function Build-TauriInstaller {
    Push-Location $frontendDir
    try {
        Invoke-NativeCommand -Command "pnpm" -Arguments @("tauri", "build")
    } finally {
        Pop-Location
    }
}

function Write-BuildSummary {
    param([Parameter(Mandatory)][string]$Title)

    $line = "=" * 54
    Write-Host ""
    Write-Host $line -ForegroundColor Green
    Write-Host "  $Title" -ForegroundColor Green
    Write-Host $line -ForegroundColor Green
    foreach ($name in $timings.Keys) {
        $seconds = [math]::Round($timings[$name].TotalSeconds, 1)
        Write-Host ("  {0,-30} {1,7}s" -f $name, $seconds)
    }
    Write-Host $line -ForegroundColor Green
}

try {
    $needsNode = (-not $SkipFrontend) -or $Tauri
    $needsGo = -not $SkipGateway
    $needsCargo = (-not $SkipEngine) -or $Tauri

    Write-Section "Prerequisites"
    Test-Prerequisite -Name "node" -Required $needsNode
    Test-Prerequisite -Name "pnpm" -Required $needsNode
    Test-Prerequisite -Name "go" -Required $needsGo -VersionArguments @("version")
    Test-Prerequisite -Name "cargo" -Required $needsCargo
    Test-Prerequisite -Name "rustc" -Required ([bool]$Tauri) -VersionArguments @("--version")
    Resolve-Protoc -Required $needsCargo

    if ($Parallel -and -not $SkipEngine -and -not $SkipGateway) {
        Invoke-ParallelCoreBuilds
    } else {
        if (-not $SkipEngine) {
            Invoke-TimedStep -Name "engine" -Action { Build-Engine }
        }
        if (-not $SkipGateway) {
            Invoke-TimedStep -Name "gateway" -Action { Build-Gateway }
        }
    }

    if (-not $SkipFrontend) {
        Invoke-TimedStep -Name "frontend" -Action { Build-Frontend }
    }

    if ($Tauri) {
        Invoke-TimedStep -Name "tauri sidecar" -Action { Prepare-TauriSidecar }

        if ($Debug) {
            Write-BuildSummary "Preparation complete"
            Start-TauriDevelopment
            return
        }

        Invoke-TimedStep -Name "tauri installer" -Action { Build-TauriInstaller }
    }

    Write-BuildSummary "Build complete"

    if ($Tauri -and -not $Debug) {
        Write-Host ""
        Write-Host "  MSI:  $frontendDir\src-tauri\target\release\bundle\msi"
        Write-Host "  NSIS: $frontendDir\src-tauri\target\release\bundle\nsis"
        Write-Host ""
    }
} catch {
    Write-Failure $_.Exception.Message
    exit 1
}
