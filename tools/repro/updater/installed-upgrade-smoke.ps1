[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CurrentInstaller,

  [string]$ExpectedVersion = "",
  [string]$Repo = "amDosion/electron-hiprint",
  [string]$WorkDir = (Join-Path $env:TEMP "hiprint-installed-upgrade-smoke"),
  [int]$TimeoutSeconds = 240,
  [switch]$AllowExistingInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $IsWindows) {
  throw "installed-upgrade-smoke.ps1 only supports Windows runners."
}

$RepoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
$CurrentInstaller = (Resolve-Path -LiteralPath $CurrentInstaller).Path
$InstallDir = Join-Path $WorkDir "Programs\hiprint"
$AppDataRoot = Join-Path $WorkDir "AppData"
$UserDataDir = Join-Path $WorkDir "UserData"
$LauncherLogPath = Join-Path $WorkDir "online-upgrade-launcher.log"
$DownloadDir = Join-Path $WorkDir "downloads"
$EnvMap = @{
  APPDATA = $AppDataRoot
  HIPRINT_USER_DATA_DIR = $UserDataDir
}

function Write-Step([string]$Message) {
  Write-Host "==> $Message"
}

function Invoke-ChildProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [hashtable]$Environment = @{},
    [int]$Timeout = $TimeoutSeconds
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($arg in $Arguments) {
    [void]$psi.ArgumentList.Add($arg)
  }
  foreach ($key in $Environment.Keys) {
    $psi.Environment[$key] = [string]$Environment[$key]
  }

  $process = [System.Diagnostics.Process]::Start($psi)
  if (-not $process.WaitForExit($Timeout * 1000)) {
    try { $process.Kill($true) } catch {}
    throw "Timed out after ${Timeout}s: $FilePath $($Arguments -join ' ')"
  }

  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  if ($stdout.Trim()) { Write-Host $stdout.TrimEnd() }
  if ($stderr.Trim()) { Write-Host $stderr.TrimEnd() }
  if ($process.ExitCode -ne 0) {
    throw "Process failed with exit code $($process.ExitCode): $FilePath $($Arguments -join ' ')"
  }
}

function Start-ChildProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [hashtable]$Environment = @{}
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.UseShellExecute = $false
  foreach ($arg in $Arguments) {
    [void]$psi.ArgumentList.Add($arg)
  }
  foreach ($key in $Environment.Keys) {
    $psi.Environment[$key] = [string]$Environment[$key]
  }
  return [System.Diagnostics.Process]::Start($psi)
}

function Normalize-Version([string]$Value) {
  if ($Value -match "v?(\d+)\.(\d+)\.(\d+)") {
    return "$([int]$Matches[1]).$([int]$Matches[2]).$([int]$Matches[3])"
  }
  return ""
}

function Convert-CommandOutputToText {
  param([AllowNull()][object]$Output)

  if ($null -eq $Output) { return "" }
  return (($Output | Out-String).Trim())
}

function Read-PackageVersion {
  $script = "console.log(require('./package.json').version)"
  Push-Location $RepoRoot
  try {
    $output = & node -e $script
    $exitCode = $LASTEXITCODE
    $version = Convert-CommandOutputToText $output
    if ($exitCode -ne 0 -or -not $version) {
      throw "Unable to read package.json version."
    }
    return $version
  } finally {
    Pop-Location
  }
}

function Read-AsarVersion([string]$AppAsarPath) {
  if (-not (Test-Path -LiteralPath $AppAsarPath)) {
    throw "Missing app.asar: $AppAsarPath"
  }
  $script = "const asar=require('@electron/asar'); const pkg=JSON.parse(asar.extractFile(process.argv[1],'package.json').toString()); console.log(pkg.version)"
  Push-Location $RepoRoot
  try {
    $output = & node -e $script $AppAsarPath
    $exitCode = $LASTEXITCODE
    $version = Convert-CommandOutputToText $output
    if ($exitCode -ne 0 -or -not $version) {
      throw "Unable to read app.asar version from $AppAsarPath"
    }
    return $version
  } finally {
    Pop-Location
  }
}

function New-GitHubHeaders {
  $headers = @{
    "User-Agent" = "electron-hiprint-installed-upgrade-smoke"
    "Accept" = "application/vnd.github+json"
  }
  if ($env:GITHUB_TOKEN) {
    $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN"
  }
  return $headers
}

function Get-PreviousRelease([string]$Expected) {
  $uri = "https://api.github.com/repos/$Repo/releases?per_page=30"
  $releases = Invoke-RestMethod -Uri $uri -Headers (New-GitHubHeaders)
  $expectedVersion = [version](Normalize-Version $Expected)
  $candidates = @()
  foreach ($release in $releases) {
    if ($release.draft -or $release.prerelease) { continue }
    $versionText = Normalize-Version $release.tag_name
    if (-not $versionText) { continue }
    $version = [version]$versionText
    if ($version -lt $expectedVersion) {
      $candidates += [pscustomobject]@{
        Release = $release
        Version = $version
        VersionText = $versionText
      }
    }
  }
  $selected = $candidates | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $selected) {
    throw "No previous non-prerelease GitHub release found below $Expected."
  }
  return $selected
}

function Get-WindowsX64Asset($Release) {
  $asset = $Release.assets | Where-Object {
    $_.name -match "^hiprint_win_x64-\d+\.\d+\.\d+.*\.exe$" -and $_.size -gt 0
  } | Select-Object -First 1
  if (-not $asset) {
    throw "Release $($Release.tag_name) has no Windows x64 installer asset."
  }
  if (-not ($asset.digest -match "^sha256:[a-fA-F0-9]{64}$")) {
    throw "Release asset $($asset.name) has no sha256 digest."
  }
  return $asset
}

function Download-ReleaseAsset($Asset) {
  New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
  $destination = Join-Path $DownloadDir $Asset.name
  Write-Step "Downloading previous installer $($Asset.name)"
  Invoke-WebRequest -Uri $Asset.browser_download_url -Headers (New-GitHubHeaders) -OutFile $destination
  $expectedHash = $Asset.digest.Substring("sha256:".Length).ToLowerInvariant()
  $actualHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "Previous installer sha256 mismatch: expected $expectedHash, got $actualHash"
  }
  return $destination
}

function Invoke-Installer([string]$InstallerPath, [string[]]$ExtraArgs = @()) {
  $args = @("/S", "/KEEP_APP_DATA") + $ExtraArgs + @("/D=$InstallDir")
  Write-Step "Running installer $([System.IO.Path]::GetFileName($InstallerPath)) $($args -join ' ')"
  Invoke-ChildProcess -FilePath $InstallerPath -Arguments $args -Environment $EnvMap -Timeout $TimeoutSeconds
}

function Wait-ForLogMatch([string]$Path, [string]$Pattern, [int]$Timeout = $TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Timeout)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      $content = Get-Content -LiteralPath $Path -Raw
      if ($content -match $Pattern) {
        return $content
      }
    }
    Start-Sleep -Milliseconds 500
  }
  $tail = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Tail 80 | Out-String } else { "<missing>" }
  throw "Timed out waiting for log pattern '$Pattern' in $Path. Tail: $tail"
}

function Stop-SmokeProcess($Process) {
  if (-not $Process) { return }
  try { $Process.Refresh() } catch {}
  if (-not $Process.HasExited) {
    Write-Step "Stopping hiprint pid $($Process.Id)"
    try { Stop-Process -Id $Process.Id -Force -ErrorAction Stop } catch {}
    try { Wait-Process -Id $Process.Id -Timeout 30 -ErrorAction SilentlyContinue } catch {}
  }
}

function Assert-Version([string]$Expected, [string]$Context) {
  $asarPath = Join-Path $InstallDir "resources\app.asar"
  $actual = Read-AsarVersion $asarPath
  if ($actual -ne $Expected) {
    throw "$Context version mismatch: expected $Expected, got $actual"
  }
  Write-Step "$Context app.asar version verified: $actual"
}

function Read-StartupLog([string]$DbPath) {
  $script = @"
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[1]);
db.get("SELECT msg FROM software_logs WHERE msg LIKE '%Electron-hiprint 启动%' ORDER BY id DESC LIMIT 1", [], (err, row) => {
  if (err) { console.error(err.message); process.exit(1); return; }
  if (!row) { process.exit(2); return; }
  console.log(row.msg);
  db.close();
});
"@
  Push-Location $RepoRoot
  try {
    $output = & node -e $script $DbPath
    $exitCode = $LASTEXITCODE
    $log = Convert-CommandOutputToText $output
    if ($exitCode -eq 0 -and $log) {
      return $log
    }
    return ""
  } finally {
    Pop-Location
  }
}

function Get-SmokeDatabasePaths {
  $paths = New-Object System.Collections.Generic.List[string]
  $paths.Add((Join-Path $UserDataDir "database.sqlite"))
  foreach ($appName in @("electron-hiprint", "hiprint")) {
    $paths.Add((Join-Path $AppDataRoot "$appName\database.sqlite"))
  }

  if (Test-Path -LiteralPath $AppDataRoot) {
    $found = Get-ChildItem -LiteralPath $AppDataRoot -Filter "database.sqlite" -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName
    foreach ($path in $found) {
      $paths.Add($path)
    }
  }

  return $paths | Select-Object -Unique
}

function Get-SmokeDatabaseDiagnostics {
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($path in Get-SmokeDatabasePaths) {
    if (Test-Path -LiteralPath $path) {
      $item = Get-Item -LiteralPath $path
      $lines.Add("exists size=$($item.Length) $path")
    } else {
      $lines.Add("missing $path")
    }
  }

  return ($lines -join [Environment]::NewLine)
}

function Assert-StartupLog {
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $deadline) {
    foreach ($dbPath in Get-SmokeDatabasePaths) {
      if (-not (Test-Path -LiteralPath $dbPath)) { continue }
      $log = Read-StartupLog $dbPath
      if ($log) {
        Write-Step "Startup sqlite log verified in $dbPath`: $log"
        return
      }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Installed app startup log was not written within 60s. Checked database paths:$([Environment]::NewLine)$(Get-SmokeDatabaseDiagnostics)"
}

function Assert-NoExternalInstall {
  if ($AllowExistingInstall) { return }

  $defaultInstallDir = Join-Path $env:LOCALAPPDATA "Programs\hiprint"
  $defaultAsar = Join-Path $defaultInstallDir "resources\app.asar"
  if (-not (Test-Path -LiteralPath $defaultAsar)) { return }

  $resolvedDefault = (Resolve-Path -LiteralPath $defaultInstallDir).Path
  $resolvedSmoke = if (Test-Path -LiteralPath $InstallDir) {
    (Resolve-Path -LiteralPath $InstallDir).Path
  } else {
    [System.IO.Path]::GetFullPath($InstallDir)
  }

  if ($resolvedDefault -ne $resolvedSmoke) {
    throw "Existing hiprint install detected at $resolvedDefault. Run this smoke on a clean Windows runner, or pass -AllowExistingInstall only if clobbering the registered install is intentional."
  }
}

function Invoke-DeferredUpgrade([int]$WaitPid) {
  $nodeScript = @"
const { launchInstallerAfterProcessExit } = require('./src/deferred-installer-launcher');
const installerPath = process.argv[1];
const waitPid = Number(process.argv[2]);
const launcherLogPath = process.argv[3];
const installDir = process.argv[4];
launchInstallerAfterProcessExit(installerPath, {
  waitPid,
  launcherLogPath,
  readyTimeoutMs: 15000,
  installerArgs: ['/S', '/KEEP_APP_DATA', '/D=' + installDir],
  waitForInstallerExit: true,
}).then(() => {
  console.log('launcher-ready');
}).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
"@
  Push-Location $RepoRoot
  try {
    Invoke-ChildProcess -FilePath "node" -Arguments @("-e", $nodeScript, $CurrentInstaller, [string]$WaitPid, $LauncherLogPath, $InstallDir) -Environment $EnvMap -Timeout 30
  } finally {
    Pop-Location
  }
}

$oldApp = $null
$newApp = $null

try {
  if (-not $ExpectedVersion) {
    $ExpectedVersion = Read-PackageVersion
  }
  $ExpectedVersion = Normalize-Version $ExpectedVersion
  if (-not $ExpectedVersion) {
    throw "Expected version is invalid."
  }

  Write-Step "Preparing isolated smoke root $WorkDir"
  Assert-NoExternalInstall
  if (Test-Path -LiteralPath $WorkDir) {
    Remove-Item -LiteralPath $WorkDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $WorkDir, $AppDataRoot, $UserDataDir, $DownloadDir | Out-Null

  $previous = Get-PreviousRelease $ExpectedVersion
  $asset = Get-WindowsX64Asset $previous.Release
  $previousInstaller = Download-ReleaseAsset $asset

  Invoke-Installer $previousInstaller
  Assert-Version $previous.VersionText "Previous install"

  $appExe = Join-Path $InstallDir "hiprint.exe"
  if (-not (Test-Path -LiteralPath $appExe)) {
    throw "Missing installed app exe: $appExe"
  }

  Write-Step "Starting previous installed app"
  $oldApp = Start-ChildProcess -FilePath $appExe -Environment $EnvMap
  Start-Sleep -Seconds 8
  $oldApp.Refresh()
  if ($oldApp.HasExited) {
    throw "Previous installed app exited before upgrade handoff."
  }

  Write-Step "Scheduling deferred current installer behind pid $($oldApp.Id)"
  Invoke-DeferredUpgrade $oldApp.Id
  Stop-SmokeProcess $oldApp
  $oldApp = $null

  $launcherLog = Wait-ForLogMatch $LauncherLogPath "installer exit code 0" $TimeoutSeconds
  Write-Step "Deferred launcher completed"
  Write-Host $launcherLog.TrimEnd()

  Assert-Version $ExpectedVersion "Upgraded install"
  Push-Location $RepoRoot
  try {
    Invoke-ChildProcess -FilePath "node" -Arguments @("tools/repro/runtime/packaged-dependency-check.js", (Join-Path $InstallDir "resources\app.asar")) -Environment $EnvMap -Timeout 30
  } finally {
    Pop-Location
  }

  Write-Step "Starting upgraded installed app"
  $newApp = Start-ChildProcess -FilePath $appExe -Environment $EnvMap
  Start-Sleep -Seconds 12
  $newApp.Refresh()
  if ($newApp.HasExited) {
    throw "Upgraded installed app exited during startup."
  }
  Assert-StartupLog

  Write-Step "Installed online-upgrade smoke passed"
} finally {
  Stop-SmokeProcess $newApp
  Stop-SmokeProcess $oldApp
  $uninstaller = Join-Path $InstallDir "Uninstall hiprint.exe"
  if (Test-Path -LiteralPath $uninstaller) {
    try {
      Invoke-ChildProcess -FilePath $uninstaller -Arguments @("/S", "--delete-app-data") -Environment $EnvMap -Timeout 120
    } catch {
      Write-Warning "Smoke cleanup uninstaller failed: $($_.Exception.Message)"
    }
  }
}
