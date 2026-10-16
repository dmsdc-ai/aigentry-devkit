param(
  [switch]$Force
)

# D2: refuse in-process before manifest access, resolution, children or journal.
[Console]::Error.WriteLine("setup: Windows asset writes unavailable; native private storage proof required. Legacy installation is gated.")
exit 1

$ErrorActionPreference = "Stop"

$DevkitDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $HOME ".claude"
$McpDest = Join-Path $HOME ".local\lib\mcp-deliberation"
$McpConfig = Join-Path $ClaudeDir ".mcp.json"
$ManifestPath = if ($env:AIGENTRY_INSTALL_MANIFEST) { $env:AIGENTRY_INSTALL_MANIFEST } else { Join-Path $DevkitDir "config\installer-manifest.json" }
$InstallProfile = if ($env:AIGENTRY_INSTALL_PROFILE) { $env:AIGENTRY_INSTALL_PROFILE } else { "core" }
$InstallComponents = if ($env:AIGENTRY_INSTALL_COMPONENTS) { $env:AIGENTRY_INSTALL_COMPONENTS.Split(",") | Where-Object { $_ } } else { @("devkit-core", "telepty", "deliberation") }
$OptionalComponents = if ($env:AIGENTRY_OPTIONAL_COMPONENTS) { $env:AIGENTRY_OPTIONAL_COMPONENTS.Split(",") | Where-Object { $_ } } else { @() }
$ResumeTarget = $env:AIGENTRY_INSTALL_RESUME
$StartPhase = 0
$ResumeResolvedFrom = "none"
$DevkitStateDir = if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "aigentry-devkit" } else { Join-Path $HOME ".config\aigentry-devkit" }
$DevkitStateFile = Join-Path $DevkitStateDir "install-state.json"
$DevkitEnvFile = Join-Path $DevkitStateDir "env.ps1"
$TeleptyBaseUrl = if ($env:AIGENTRY_TELEPTY_URL) { $env:AIGENTRY_TELEPTY_URL } else { "http://localhost:3848" }
$DeliberationRuntimePath = $McpDest
$BrainProfileRoot = if ($env:AIGENTRY_BRAIN_PROFILE_ROOT) { $env:AIGENTRY_BRAIN_PROFILE_ROOT } else { Join-Path $HOME ".aigentry" }
$BrainInstallMode = if ($env:AIGENTRY_BRAIN_INSTALL_MODE) { $env:AIGENTRY_BRAIN_INSTALL_MODE } else { "local" }
$BrainRemoteUrl = $env:AIGENTRY_BRAIN_REMOTE_URL
$BrainProjectId = $env:AIGENTRY_BRAIN_PROJECT_ID
$BrainServiceUrl = $env:AIGENTRY_BRAIN_URL
$DustcrawPreset = $env:AIGENTRY_DUSTCRAW_PRESET
$DustcrawRunDemo = $env:AIGENTRY_DUSTCRAW_RUN_DEMO
$DustcrawEnableService = $env:AIGENTRY_DUSTCRAW_ENABLE_SERVICE
$RegistryMode = $env:AIGENTRY_REGISTRY_MODE
$RegistryApiUrl = $env:AIGENTRY_API_URL
$RegistryApiKey = $env:AIGENTRY_API_KEY
$RegistryRepoDir = $env:AIGENTRY_REGISTRY_REPO_DIR
$RegistryTenantName = if ($env:AIGENTRY_REGISTRY_TENANT_NAME) { $env:AIGENTRY_REGISTRY_TENANT_NAME } else { "aigentry" }
$RegistryTenantSlug = if ($env:AIGENTRY_REGISTRY_TENANT_SLUG) { $env:AIGENTRY_REGISTRY_TENANT_SLUG } else { "aigentry" }
$RegistryApiKeyName = if ($env:AIGENTRY_REGISTRY_API_KEY_NAME) { $env:AIGENTRY_REGISTRY_API_KEY_NAME } else { "devkit-installer" }
$TeleptyInstalledVersion = ""
$DeliberationDoctorOk = $false
$BrainSelected = $false
$BrainPackage = ""
$DustcrawSelected = $false
$DustcrawPackage = ""
$DustcrawConfigPath = ""

# Recovery journal state (#1147), same contract and same writer as install.sh.
$JournalCli = Join-Path $DevkitDir "lib\install-state.js"
$DevkitJournalFile = Join-Path $DevkitStateDir "install-journal.json"
$InstallRunId = ""
$SkipPhases = @()
$CurrentPhase = $null
$PhaseDegraded = ""
$JournalClosed = $false
$UnknownEffectPolicy = if ($env:AIGENTRY_INSTALL_UNKNOWN_EFFECT) { $env:AIGENTRY_INSTALL_UNKNOWN_EFFECT } else { "refuse" }
$ForceUnlock = if ($env:AIGENTRY_INSTALL_FORCE_UNLOCK) { $env:AIGENTRY_INSTALL_FORCE_UNLOCK } else { "0" }

if (-not (Test-Path $ManifestPath)) {
  throw "Installer manifest not found: $ManifestPath"
}

$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json

if ($ResumeTarget) {
  if ($ResumeTarget -match '^\d+$') {
    $StartPhase = [int]$ResumeTarget
    $ResumeResolvedFrom = "numeric"
  } elseif ($Manifest.components.PSObject.Properties.Name -contains $ResumeTarget) {
    $StartPhase = [int]$Manifest.components.$ResumeTarget.phase
    $ResumeResolvedFrom = "component"
  } else {
    throw "Unknown resume target: $ResumeTarget"
  }
}

function Write-Info([string]$Message) {
  Write-Host "[+] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "[!] $Message" -ForegroundColor Yellow
}

function Write-Header([string]$Message) {
  Write-Host ""
  Write-Host $Message -ForegroundColor Cyan
}

function Test-ComponentSelected([string]$Name) {
  return $InstallComponents -contains $Name
}

function Should-RunPhase([int]$Phase) {
  if ($Phase -lt $StartPhase) { return $false }
  # Phases the journal told us to leave alone (AIGENTRY_INSTALL_UNKNOWN_EFFECT=skip).
  if ($script:SkipPhases -contains $Phase) { return $false }
  return $true
}

function Is-Interactive {
  return [Environment]::UserInteractive
}

function Prompt-Value([ref]$Variable, [string]$Prompt, [string]$Default = "") {
  if ($Variable.Value) { return }
  if (Is-Interactive) {
    $suffix = if ($Default) { " [$Default]" } else { "" }
    $input = Read-Host "$Prompt$suffix"
    if ($input) { $Variable.Value = $input } else { $Variable.Value = $Default }
  } else {
    $Variable.Value = $Default
  }
}

function Prompt-Secret([ref]$Variable, [string]$Prompt) {
  if ($Variable.Value) { return }
  if (Is-Interactive) {
    $Variable.Value = Read-Host $Prompt
  } else {
    $Variable.Value = ""
  }
}

function Prompt-Choice([ref]$Variable, [string]$Prompt, [string]$Default, [string[]]$Options) {
  if ($Variable.Value) { return }
  if (Is-Interactive) {
    Write-Host $Prompt
    for ($i = 0; $i -lt $Options.Count; $i++) {
      Write-Host "  $($i + 1)) $($Options[$i])"
    }
    $input = Read-Host ">"
    if ($input -match '^\d+$') {
      $index = [int]$input - 1
      if ($index -ge 0 -and $index -lt $Options.Count) {
        $Variable.Value = $Options[$index]
        return
      }
    }
    if ($input) { $Variable.Value = $input } else { $Variable.Value = $Default }
  } else {
    $Variable.Value = $Default
  }
}

function Normalize-Bool([string]$Value) {
  if (-not $Value) { return "" }
  switch -Regex ($Value) {
    '^(1|true|yes|y|on)$' { return "true" }
    '^(0|false|no|n|off)$' { return "false" }
    default { return "" }
  }
}

function Write-InstallerState {
  New-Item -ItemType Directory -Path $DevkitStateDir -Force | Out-Null
  # Same single writer as install.sh: atomic (tmp + rename) and mode 0600, so an
  # interruption can no longer truncate the file and a torn file can no longer
  # read as "nothing installed" (#1147 F7).
  #
  # AIGENTRY_API_KEY is deliberately NOT handed over: the writer only receives a
  # presence boolean, so the durable record cannot contain the secret (#1147
  # F8/H1). env.ps1 stays its only sink.
  $vars = [ordered]@{
    AIGENTRY_ST_PROFILE = $InstallProfile
    AIGENTRY_ST_MANIFEST = $ManifestPath
    AIGENTRY_ST_COMPONENTS = ($InstallComponents -join ",")
    AIGENTRY_ST_OPTIONAL_COMPONENTS = ($OptionalComponents -join ",")
    AIGENTRY_ST_JOURNAL_PATH = $DevkitJournalFile
    AIGENTRY_ST_TELEPTY_VERSION = $TeleptyInstalledVersion
    AIGENTRY_ST_TELEPTY_BASE_URL = $TeleptyBaseUrl
    AIGENTRY_ST_DELIBERATION_RUNTIME_PATH = $DeliberationRuntimePath
    AIGENTRY_ST_DELIBERATION_DOCTOR_OK = $(if ($DeliberationDoctorOk) { "true" } else { "false" })
    AIGENTRY_ST_BRAIN_SELECTED = $(if ($BrainSelected) { "true" } else { "false" })
    AIGENTRY_ST_BRAIN_PACKAGE = $BrainPackage
    AIGENTRY_ST_BRAIN_PROFILE_ROOT = $BrainProfileRoot
    AIGENTRY_ST_BRAIN_INSTALL_MODE = $BrainInstallMode
    AIGENTRY_ST_BRAIN_REMOTE_URL = $BrainRemoteUrl
    AIGENTRY_ST_BRAIN_PROJECT_ID = $BrainProjectId
    AIGENTRY_ST_REGISTRY_MODE = $RegistryMode
    AIGENTRY_ST_REGISTRY_API_URL = $RegistryApiUrl
    AIGENTRY_ST_REGISTRY_API_KEY_PRESENT = $(if ($RegistryApiKey) { "true" } else { "false" })
    AIGENTRY_ST_DUSTCRAW_SELECTED = $(if ($DustcrawSelected) { "true" } else { "false" })
    AIGENTRY_ST_DUSTCRAW_PACKAGE = $DustcrawPackage
    AIGENTRY_ST_DUSTCRAW_PRESET = $DustcrawPreset
    AIGENTRY_ST_DUSTCRAW_CONFIG_PATH = $DustcrawConfigPath
  }
  foreach ($name in $vars.Keys) { Set-Item -Path "env:$name" -Value ([string]$vars[$name]) }
  try {
    & node $JournalCli write-state --file $DevkitStateFile
    if ($LASTEXITCODE -ne 0) { throw "installer state could not be written to $DevkitStateFile" }
  } finally {
    foreach ($name in $vars.Keys) { Remove-Item -Path "env:$name" -ErrorAction SilentlyContinue }
  }
}

# ── recovery journal (#1147 F6/F7/F8) ───────────────────────────────────────
# lib\install-state.js is the single writer, shared with install.sh, so the two
# installers cannot drift on schema, atomicity, permissions or redaction.
# Limitation, stated rather than papered over: PowerShell has no portable signal
# handler, so Ctrl-C / a hard kill runs neither `trap` nor `finally`. Such a run
# leaves its phase `running` on disk and the NEXT run reclassifies it `unknown`
# — which is exactly the interrupted-effect path, never a silent success.
function Start-InstallJournal {
  # Flags with an empty value are omitted rather than passed as "": Windows
  # PowerShell 5.1 does not reliably hand an empty argument to a native command,
  # and a dropped one would shift every flag after it. The reader defaults any
  # absent flag to the same empty value.
  $journalArgs = @("begin-run", "--dir", $DevkitStateDir, "--installer", "install.ps1",
    "--start-phase", "$StartPhase", "--resolved-from", $ResumeResolvedFrom,
    "--unknown-effect", $UnknownEffectPolicy, "--force-unlock", $ForceUnlock,
    "--registry-api-key-present", $(if ($RegistryApiKey) { "true" } else { "false" }))
  if ($InstallProfile) { $journalArgs += @("--profile", $InstallProfile) }
  if ($InstallComponents) { $journalArgs += @("--components", ($InstallComponents -join ",")) }
  if ($OptionalComponents) { $journalArgs += @("--optional-components", ($OptionalComponents -join ",")) }
  if ($ResumeTarget) { $journalArgs += @("--resume-raw", $ResumeTarget) }
  $line = & node $JournalCli @journalArgs
  $fields = @("$line" -split "`t", 5)
  if ($LASTEXITCODE -ne 0) {
    throw $(if ($fields.Count -gt 4 -and $fields[4]) { $fields[4] } else { "installer recovery journal could not be opened at $DevkitJournalFile; nothing was installed" })
  }
  $script:InstallRunId = $fields[1]
  if ($fields[3] -and $fields[3] -ne "-") { $script:SkipPhases = @($fields[3] -split "," | Where-Object { $_ } | ForEach-Object { [int]$_ }) }
  Write-Info $fields[4]
}

function Start-JournalPhase([int]$Phase) {
  $script:CurrentPhase = $Phase
  $script:PhaseDegraded = ""
  & node $JournalCli phase-begin --dir $DevkitStateDir --run $script:InstallRunId --phase $Phase
  if ($LASTEXITCODE -ne 0) { throw "could not record the start of phase $Phase in $DevkitJournalFile; this phase changed nothing" }
}

function Complete-JournalPhase([int]$Phase) {
  $journalArgs = @("phase-end", "--dir", $DevkitStateDir, "--run", $script:InstallRunId, "--phase", "$Phase", "--status", "completed")
  if ($script:PhaseDegraded) { $journalArgs += @("--degraded", "1", "--detail", $script:PhaseDegraded) }
  $script:CurrentPhase = $null
  $script:PhaseDegraded = ""
  & node $JournalCli @journalArgs
  if ($LASTEXITCODE -ne 0) { Write-Warn "could not record the completion of phase $Phase in $DevkitJournalFile" }
}

# A soft failure inside a phase: the installer continues by policy, the record
# keeps the reason and marks the phase degraded rather than completed-clean.
function Set-PhaseDegraded([string]$Reason) {
  $script:PhaseDegraded = $(if ($script:PhaseDegraded) { "$($script:PhaseDegraded); $Reason" } else { $Reason })
  Write-Warn $Reason
}

function Stop-InstallJournal([string]$Outcome, [int]$ExitCode) {
  if ($script:JournalClosed -or -not $script:InstallRunId) { return }
  $script:JournalClosed = $true
  if ($null -ne $script:CurrentPhase -and $Outcome -ne "completed") {
    & node $JournalCli phase-end --dir $DevkitStateDir --run $script:InstallRunId --phase $script:CurrentPhase `
      --status failed --exit-code $ExitCode --detail "installer stopped inside phase $($script:CurrentPhase)" 2>$null | Out-Null
  }
  & node $JournalCli end-run --dir $DevkitStateDir --run $script:InstallRunId --outcome $Outcome --exit-code $ExitCode 2>$null | Out-Null
  Remove-OwnedTemp
}

# Owned temporary artifacts only: the credential-bearing dustcraw config THIS
# run created (#1147 F8). Removed on success and failure alike.
function Remove-OwnedTemp {
  if ($script:DustcrawConfigPath -and (Test-Path $script:DustcrawConfigPath)) {
    Remove-Item -Path $script:DustcrawConfigPath -Force -ErrorAction SilentlyContinue
    $script:DustcrawConfigPath = ""
  }
}

function Write-EnvFanout {
  New-Item -ItemType Directory -Path $DevkitStateDir -Force | Out-Null
  $lines = @(
    '# Generated by aigentry-devkit installer'
  )
  if ($RegistryApiUrl) { $lines += "`$env:AIGENTRY_API_URL = '$RegistryApiUrl'" }
  if ($RegistryApiKey) { $lines += "`$env:AIGENTRY_API_KEY = '$RegistryApiKey'" }
  if ($BrainRemoteUrl) { $lines += "`$env:BRAIN_REMOTE_URL = '$BrainRemoteUrl'" }
  if ($BrainProjectId) { $lines += "`$env:BRAIN_PROJECT_ID = '$BrainProjectId'" }
  $lines | Set-Content -Path $DevkitEnvFile -Encoding utf8
}

function Invoke-RegistrySmokeTest([string]$BaseUrl, [string]$ApiKey) {
  try {
    Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/') + '/health') -TimeoutSec 3 | Out-Null
    Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/') + '/api/experiments/leaderboard?page=1&size=1') -Headers @{ 'X-API-Key' = $ApiKey } -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    return $false
  }
}

# Any terminating error below records the running phase as failed and releases
# the journal lock before the installer dies, so a partial install is never left
# without a record (#1147 F6). `break` re-raises, so the error still surfaces.
trap {
  Stop-InstallJournal "failed" 1
  break
}

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "   aigentry-devkit installer (PowerShell)" -ForegroundColor Cyan
Write-Host "   AI Development Environment Kit" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Info "Profile: $InstallProfile"
Write-Info "Manifest: $ManifestPath"
Write-Info "Components: $($InstallComponents -join ',')"
if ($OptionalComponents.Count -gt 0) { Write-Info "Optional profile components: $($OptionalComponents -join ',')" }
if ($ResumeTarget) { Write-Info "Resume target: $ResumeTarget (starting at phase $StartPhase)" }

Write-Header "Phase 0. Prerequisites"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "node not found. Install Node.js 18+ first." }
Write-Info "Node.js $(& node -v) found"
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) { throw "npm not found. Install Node.js (npm included)." }
# node is present, so the durable record can be opened before anything mutates
# the machine. A corrupt, unsupported, locked or interrupted-unknown journal
# refuses here, with nothing installed and nothing deleted (#1147 F6).
Start-InstallJournal
Start-JournalPhase 0
if (Get-Command tmux -ErrorAction SilentlyContinue) {
  Write-Info "tmux found (deliberation monitor can run in tmux)"
} else {
  Write-Warn "tmux is not natively available on Windows. Deliberation monitor auto-window is disabled."
}
if (Get-Command claude -ErrorAction SilentlyContinue) {
  Write-Info "Claude Code CLI found"
} else {
  Write-Warn "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
}
Complete-JournalPhase 0

$skillsDest = Join-Path $ClaudeDir "skills"
# Parity with install.sh (#1204): every agent CLI reads skills from its own user dir.
# Claude Code's is always a destination; another CLI's only when it is on PATH or its
# config dir already exists. agy's global customization root is ~/.gemini/config.
$skillsDests = @($skillsDest)
foreach ($cliDest in @(
    @("codex", (Join-Path $HOME ".codex"), (Join-Path $HOME ".codex\skills")),
    @("gemini", (Join-Path $HOME ".gemini"), (Join-Path $HOME ".gemini\skills")),
    @("agy", (Join-Path $HOME ".gemini\config"), (Join-Path $HOME ".gemini\config\skills")),
    @("grok", (Join-Path $HOME ".grok"), (Join-Path $HOME ".grok\skills")))) {
  if ((Get-Command $cliDest[0] -ErrorAction SilentlyContinue) -or (Test-Path $cliDest[1])) { $skillsDests += $cliDest[2] }
}
$hudDest = Join-Path $ClaudeDir "hud"
$wtmSrc = Join-Path $DevkitDir "tools\wtm"
$wtmDest = Join-Path $HOME ".local\lib\wtm"

if ((Should-RunPhase 1) -and (Test-ComponentSelected "devkit-core")) {
  Write-Header "Phase 1. Devkit Core Assets"
  Start-JournalPhase 1

  # Parity with install.sh: bundled skills (skills/*) + distributable template
  # skills (templates/skills/*) install the same way (#739 D2).
  # De-listed skills (#739 D1/D4): kept in git, never shipped and never installed.
  # Keep in sync with package.json "files" (which omits the same directories).
  $skillsDelisted = @("project-ops", "clipboard-image", "youtube-analyzer")
  $skillSources = @((Join-Path $DevkitDir "skills"), (Join-Path $DevkitDir "templates\skills"))
  foreach ($dest in $skillsDests) {
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    foreach ($skillDir in ($skillSources | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Directory })) {
      if ($skillsDelisted -contains $skillDir.Name) { continue }
      $target = Join-Path $dest $skillDir.Name
      if (Test-Path $target) {
        if ($Force) { Remove-Item -Recurse -Force $target } else { Write-Warn "$($skillDir.Name) already exists in $dest (skipping, use -Force to overwrite)"; continue }
      }
      Copy-Item -Path $skillDir.FullName -Destination $target -Recurse
      Write-Info "Installed skill: $($skillDir.Name) -> $dest"
    }
  }

  New-Item -ItemType Directory -Path $hudDest -Force | Out-Null
  $hudTarget = Join-Path $hudDest "simple-status.sh"
  $hudSource = Join-Path $DevkitDir "hud\simple-status.sh"
  if (-not (Test-Path $hudTarget) -or $Force) {
    Copy-Item -Path $hudSource -Destination $hudTarget -Force
    Write-Info "Installed HUD: simple-status.sh"
  }

  $settingsDest = Join-Path $ClaudeDir "settings.json"
  $settingsTemplate = Join-Path $DevkitDir "config\settings.json.template"
  if (-not (Test-Path $settingsDest) -and (Test-Path $settingsTemplate)) {
    (Get-Content $settingsTemplate -Raw).Replace("{{HOME}}", $HOME) | Set-Content -Path $settingsDest -Encoding utf8
    Write-Info "Created settings.json from template"
  }
  # TODO(#1204): merge the SessionStart(compact) hooks\post-compact-restore.sh entry (install.sh 8.9 mergeClaudeHooks) — no PowerShell settings.json merge path exists yet.

  if (Test-Path $wtmSrc) {
    New-Item -ItemType Directory -Path $wtmDest -Force | Out-Null
    Copy-Item -Path (Join-Path $wtmSrc '*') -Destination $wtmDest -Recurse -Force
    Write-Info "WTM copied to $wtmDest"
  }
  Complete-JournalPhase 1
}

if ((Should-RunPhase 2) -and (Test-ComponentSelected "telepty")) {
  Write-Header "Phase 2. Telepty"
  Start-JournalPhase 2
  # #1213: same shared policy as install.sh (lib\telepty-version-policy.js), which runs
  # the bounded `telepty --version` probe itself (5s, 1024 bytes). npm runs only for an
  # absent or too-old telepty; a newer compatible install is kept, and an
  # incompatible/unidentifiable one is refused untouched. No `latest` fallback.
  $teleptyPolicy = Join-Path $DevkitDir "lib\telepty-version-policy.js"
  function Invoke-TeleptyPolicy([string]$Mode) {
    # The decision comes back as one tab-separated line.
    $line = & node $teleptyPolicy --mode $Mode --manifest $ManifestPath --probe bounded
    $policyExit = $LASTEXITCODE
    $fields = @("$line" -split "`t", 5)
    return [pscustomobject]@{
      ExitCode = $policyExit
      Action = $fields[0]
      Spec = $(if ($fields.Count -gt 2) { $fields[2] } else { "-" })
      Observed = $(if ($fields.Count -gt 3) { $fields[3] } else { "-" })
      Message = $(if ($fields.Count -gt 4) { $fields[4] } else { "" })
    }
  }
  $teleptyDecision = Invoke-TeleptyPolicy "plan"
  if ($teleptyDecision.ExitCode -ne 0 -or $teleptyDecision.Action -notin @("keep", "install", "upgrade")) {
    throw $(if ($teleptyDecision.Message) { $teleptyDecision.Message } else { "telepty version policy failed (lib\telepty-version-policy.js)" })
  }
  Write-Info $teleptyDecision.Message
  if ($teleptyDecision.Action -ne "keep") {
    npm install -g $teleptyDecision.Spec
    if ($LASTEXITCODE -ne 0) { throw "npm install -g $($teleptyDecision.Spec) failed; no other telepty version was tried" }
    if (-not (Get-Command telepty -ErrorAction SilentlyContinue)) { throw "telepty command not found after install" }
    $teleptyDecision = Invoke-TeleptyPolicy "verify"
    if ($teleptyDecision.ExitCode -ne 0 -or $teleptyDecision.Action -ne "keep") {
      throw $(if ($teleptyDecision.Message) { $teleptyDecision.Message } else { "telepty version policy failed after install" })
    }
    Write-Info $teleptyDecision.Message
  }
  $TeleptyInstalledVersion = $teleptyDecision.Observed
  telepty daemon | Out-Null
  $healthy = $false
  for ($i = 0; $i -lt 10; $i++) {
    try {
      $meta = Invoke-RestMethod -Uri ($TeleptyBaseUrl + '/api/meta') -TimeoutSec 2
      if ($meta.version) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $healthy) { throw "telepty daemon health check failed (GET /api/meta)" }
  Write-Info "telepty daemon is healthy"
  Complete-JournalPhase 2
}

if ((Should-RunPhase 3) -and (Test-ComponentSelected "deliberation")) {
  Write-Header "Phase 3. Deliberation"
  Start-JournalPhase 3
  Write-Info "Running canonical deliberation installer"
  npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-install
  if ($LASTEXITCODE -ne 0) { throw "Canonical deliberation installer failed" }

  Write-Info "Running deliberation doctor"
  try {
    npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-doctor
    if ($LASTEXITCODE -eq 0) { $DeliberationDoctorOk = $true; Write-Info "deliberation doctor passed" } else { Set-PhaseDegraded "deliberation doctor failed" }
  } catch {
    Set-PhaseDegraded "deliberation doctor failed"
  }
  Complete-JournalPhase 3
}

if ((Should-RunPhase 4) -and (Test-ComponentSelected "brain")) {
  Write-Header "Phase 4. Brain"
  Start-JournalPhase 4
  $BrainSelected = $true
  $BrainPackage = $Manifest.components.brain.install.package
  Prompt-Choice ([ref]$BrainInstallMode) "Choose brain install mode" $BrainInstallMode @("local", "sync")
  if ($BrainInstallMode -eq "sync") {
    Prompt-Value ([ref]$BrainRemoteUrl) "Brain remote sync URL (optional)" $BrainRemoteUrl
  }
  Prompt-Value ([ref]$BrainProjectId) "Brain project id (optional)" $BrainProjectId
  Write-Info "Installing $BrainPackage"
  npm install -g $BrainPackage
  if ($LASTEXITCODE -eq 0 -and (Get-Command aigentry-brain -ErrorAction SilentlyContinue)) {
    try {
      aigentry-brain health | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Info "aigentry-brain health check passed" } else { Set-PhaseDegraded "aigentry-brain health check failed. Run 'aigentry-brain setup' for manual completion." }
    } catch {
      Set-PhaseDegraded "aigentry-brain health check failed. Run 'aigentry-brain setup' for manual completion."
    }
  } else {
    Set-PhaseDegraded "aigentry-brain install failed"
  }
  Complete-JournalPhase 4
}

if ((Should-RunPhase 5) -and (Test-ComponentSelected "dustcraw")) {
  Write-Header "Phase 5. Dustcraw"
  Start-JournalPhase 5
  $DustcrawSelected = $true
  $DustcrawPackage = $Manifest.components.dustcraw.install.package
  $DustcrawVersion = $Manifest.components.dustcraw.install.version
  $DustcrawSpec = if ($DustcrawVersion) { "$DustcrawPackage@$DustcrawVersion" } else { $DustcrawPackage }
  Prompt-Choice ([ref]$DustcrawPreset) "Choose your interest profile" $(if ($DustcrawPreset) { $DustcrawPreset } else { 'tech-business' }) @("tech-business", "humanities", "finance", "creator", "custom")
  Write-Info "Installing $DustcrawSpec"
  npm install -g $DustcrawSpec
  if ($LASTEXITCODE -eq 0 -and (Get-Command dustcraw -ErrorAction SilentlyContinue)) {
    $DustcrawConfigPath = Join-Path ([IO.Path]::GetTempPath()) ("dustcraw-config-" + [guid]::NewGuid().ToString("N") + ".json")
    $dustcrawConfig = [ordered]@{ strategyPreset = $DustcrawPreset }
    if ($RegistryApiUrl) { $dustcrawConfig.registryBaseUrl = $RegistryApiUrl }
    if ($RegistryApiKey) { $dustcrawConfig.registryApiKey = $RegistryApiKey }
    if ($TeleptyBaseUrl) { $dustcrawConfig.busUrl = $TeleptyBaseUrl }
    if ($BrainServiceUrl) { $dustcrawConfig.brainUrl = $BrainServiceUrl }
    $dustcrawConfig | ConvertTo-Json -Depth 4 | Set-Content -Path $DustcrawConfigPath -Encoding utf8
    try {
      dustcraw init --preset $DustcrawPreset --config $DustcrawConfigPath --non-interactive
      if ($LASTEXITCODE -eq 0) { Write-Info "dustcraw initialized with preset '$DustcrawPreset'" } else { Set-PhaseDegraded "dustcraw init failed" }
    } catch {
      Set-PhaseDegraded "dustcraw init failed"
    }
    # The handoff file carries the registry key, so it dies with the handoff —
    # on this path, on the init-failure path and in the trap (#1147 F8). Its
    # path is cleared too, so no stale pointer is recorded in install-state.
    Remove-OwnedTemp
    if (-not $DustcrawRunDemo) {
      if (Is-Interactive) { Prompt-Choice ([ref]$DustcrawRunDemo) "Run dustcraw demo now?" "yes" @("yes", "no") } else { $DustcrawRunDemo = "yes" }
    }
    if ((Normalize-Bool $DustcrawRunDemo) -eq "true") {
      try { dustcraw demo --non-interactive } catch { Set-PhaseDegraded "dustcraw demo failed" }
    }
    if (-not $DustcrawEnableService) {
      if (Is-Interactive) { Prompt-Choice ([ref]$DustcrawEnableService) "Enable dustcraw background service now?" "no" @("yes", "no") } else { $DustcrawEnableService = "no" }
    }
    if ((Normalize-Bool $DustcrawEnableService) -eq "true") {
      Write-Warn "dustcraw service registration surface is not wired yet. Complete it in dustcraw once a stable public command is available."
    }
  } else {
    Set-PhaseDegraded "dustcraw install failed or command not found"
  }
  Complete-JournalPhase 5
}

if ((Should-RunPhase 6) -and (Test-ComponentSelected "registry-wiring")) {
  Write-Header "Phase 6. Registry Wiring"
  Start-JournalPhase 6
  Prompt-Choice ([ref]$RegistryMode) "Choose registry mode" $(if ($RegistryMode) { $RegistryMode } else { 'skip' }) @("cloud", "self_hosted", "skip")

  switch ($RegistryMode) {
    'cloud' {
      Prompt-Value ([ref]$RegistryApiUrl) "Registry base URL" $RegistryApiUrl
      Prompt-Secret ([ref]$RegistryApiKey) "Registry API key"
    }
    'self_hosted' {
      Prompt-Value ([ref]$RegistryApiUrl) "Registry base URL" $RegistryApiUrl
      if ($RegistryRepoDir -and (Test-Path (Join-Path $RegistryRepoDir 'docker-compose.yml')) -and (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Info "Starting self-hosted registry from $RegistryRepoDir\docker-compose.yml"
        Push-Location $RegistryRepoDir
        docker compose up -d
        Pop-Location
        if ($RegistryApiUrl) {
          for ($i = 0; $i -lt 10; $i++) {
            try {
              Invoke-RestMethod -Uri ($RegistryApiUrl.TrimEnd('/') + '/health') -TimeoutSec 2 | Out-Null
              break
            } catch { Start-Sleep -Seconds 2 }
          }
        }
        if (-not $RegistryApiKey -and $RegistryApiUrl) {
          $bootstrapBody = @{ tenant_name = $RegistryTenantName; tenant_slug = $RegistryTenantSlug; api_key_name = $RegistryApiKeyName } | ConvertTo-Json
          try {
            $bootstrap = Invoke-RestMethod -Uri ($RegistryApiUrl.TrimEnd('/') + '/api/v1/tenants/bootstrap') -Method Post -ContentType 'application/json' -Body $bootstrapBody
            if ($bootstrap.raw_key) { $RegistryApiKey = $bootstrap.raw_key }
          } catch {}
        }
      } else {
        Write-Warn "Self-hosted auto-bootstrap requires AIGENTRY_REGISTRY_REPO_DIR with docker-compose.yml. Falling back to manual wiring."
      }
      if (-not $RegistryApiUrl) { Prompt-Value ([ref]$RegistryApiUrl) "Registry base URL" $RegistryApiUrl }
      if (-not $RegistryApiKey) { Prompt-Secret ([ref]$RegistryApiKey) "Registry API key" }
    }
    default {
      Write-Info "Skipping registry wiring"
    }
  }

  if ($RegistryMode -ne 'skip' -and $RegistryApiUrl -and $RegistryApiKey) {
    if (Invoke-RegistrySmokeTest $RegistryApiUrl $RegistryApiKey) { Write-Info "registry wiring smoke test passed" } else { Set-PhaseDegraded "registry wiring smoke test failed" }
  }
  Complete-JournalPhase 6
}

if (Should-RunPhase 7) {
  Write-Header "Phase 7. Config Fan-Out"
  Start-JournalPhase 7
  Write-InstallerState
  Write-EnvFanout
  Write-Info "Wrote installer state: $DevkitStateFile"
  Write-Info "Wrote env fan-out: $DevkitEnvFile"
  Complete-JournalPhase 7
}

# Every mutating phase is done: close the attempt record and release the lock
# here, so a throw in the cosmetic summary below cannot turn a completed
# install into a recorded failure.
Stop-InstallJournal "completed" 0

Write-Header "Phase 8. Cross-platform Notes"
Write-Info "Manage deliberation runtime with the canonical installer surface from aigentry-deliberation."
Write-Info "Registry env fan-out is stored in $DevkitEnvFile"
Write-Info "Browser/provider auth may still require CLI restart or manual login."

Write-Header "Installation Complete!"
Write-Host ""
Write-Host "  Installed components:"
foreach ($dest in $skillsDests) {
  Write-Host "    Skills:     $((Get-ChildItem $dest -Directory -ErrorAction SilentlyContinue | Measure-Object).Count) skills in $dest"
}
Write-Host "    HUD:        $(Join-Path $hudDest 'simple-status.sh')"
Write-Host "    telepty:    $(if ($TeleptyInstalledVersion) { $TeleptyInstalledVersion } else { 'not checked' })"
Write-Host "    deliberation: $(if ($DeliberationDoctorOk) { 'healthy' } else { 'not-run' })"
Write-Host "    brain:      $(if ($BrainSelected) { 'selected' } else { 'skipped' })"
Write-Host "    dustcraw:   $(if ($DustcrawSelected) { 'selected' } else { 'skipped' })"
Write-Host "    registry:   $(if ($RegistryMode) { $RegistryMode } else { 'skip' })"
Write-Host "    WTM:        $wtmDest"
Write-Host "    Config:     $ClaudeDir"
Write-Host "    State:      $DevkitStateFile"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Restart CLI processes for MCP changes to take effect"
Write-Host "    2. Dot-source $DevkitEnvFile if you want registry env in new shells"
Write-Host "    3. Run 'aigentry-brain setup' if you want full interactive brain bootstrap"
Write-Host "    4. Configure your HUD in settings.json if not already done"
