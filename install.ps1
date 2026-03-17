param(
  [switch]$Force
)

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

if (-not (Test-Path $ManifestPath)) {
  throw "Installer manifest not found: $ManifestPath"
}

$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json

if ($ResumeTarget) {
  if ($ResumeTarget -match '^\d+$') {
    $StartPhase = [int]$ResumeTarget
  } elseif ($Manifest.components.PSObject.Properties.Name -contains $ResumeTarget) {
    $StartPhase = [int]$Manifest.components.$ResumeTarget.phase
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
  return $Phase -ge $StartPhase
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
  $state = [ordered]@{
    generated_at = (Get-Date).ToString("o")
    profile = $InstallProfile
    manifest_path = $ManifestPath
    components = $InstallComponents
    optional_components = $OptionalComponents
    telepty = [ordered]@{
      version = $(if ($TeleptyInstalledVersion) { $TeleptyInstalledVersion } else { $null })
      base_url = $TeleptyBaseUrl
    }
    deliberation = [ordered]@{
      runtime_path = $DeliberationRuntimePath
      doctor_ok = $DeliberationDoctorOk
    }
    brain = [ordered]@{
      selected = $BrainSelected
      package = $(if ($BrainPackage) { $BrainPackage } else { $null })
      profile_root = $BrainProfileRoot
      install_mode = $BrainInstallMode
      remote_url = $(if ($BrainRemoteUrl) { $BrainRemoteUrl } else { $null })
      project_id = $(if ($BrainProjectId) { $BrainProjectId } else { $null })
    }
    registry = [ordered]@{
      mode = $(if ($RegistryMode) { $RegistryMode } else { "skip" })
      api_url = $(if ($RegistryApiUrl) { $RegistryApiUrl } else { $null })
      api_key = $(if ($RegistryApiKey) { $RegistryApiKey } else { $null })
    }
    dustcraw = [ordered]@{
      selected = $DustcrawSelected
      package = $(if ($DustcrawPackage) { $DustcrawPackage } else { $null })
      preset = $(if ($DustcrawPreset) { $DustcrawPreset } else { $null })
      config_path = $(if ($DustcrawConfigPath) { $DustcrawConfigPath } else { $null })
    }
  }
  $state | ConvertTo-Json -Depth 6 | Set-Content -Path $DevkitStateFile -Encoding utf8
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

$skillsDest = Join-Path $ClaudeDir "skills"
$hudDest = Join-Path $ClaudeDir "hud"
$wtmSrc = Join-Path $DevkitDir "tools\wtm"
$wtmDest = Join-Path $HOME ".local\lib\wtm"

if (Should-RunPhase 1 -and (Test-ComponentSelected "devkit-core")) {
  Write-Header "Phase 1. Devkit Core Assets"

  New-Item -ItemType Directory -Path $skillsDest -Force | Out-Null
  foreach ($skillDir in (Get-ChildItem (Join-Path $DevkitDir "skills") -Directory)) {
    $target = Join-Path $skillsDest $skillDir.Name
    if (Test-Path $target) {
      if ($Force) { Remove-Item -Recurse -Force $target } else { Write-Warn "$($skillDir.Name) already exists (skipping, use -Force to overwrite)"; continue }
    }
    Copy-Item -Path $skillDir.FullName -Destination $target -Recurse
    Write-Info "Installed skill: $($skillDir.Name)"
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

  if (Test-Path $wtmSrc) {
    New-Item -ItemType Directory -Path $wtmDest -Force | Out-Null
    Copy-Item -Path (Join-Path $wtmSrc '*') -Destination $wtmDest -Recurse -Force
    Write-Info "WTM copied to $wtmDest"
  }
}

if (Should-RunPhase 2 -and (Test-ComponentSelected "telepty")) {
  Write-Header "Phase 2. Telepty"
  $teleptyPackage = $Manifest.components.telepty.install.package
  $teleptyVersion = $Manifest.components.telepty.install.version
  $teleptySpec = "$teleptyPackage@$teleptyVersion"
  Write-Info "Installing $teleptySpec"
  npm install -g $teleptySpec
  if ($LASTEXITCODE -ne 0) { throw "telepty installation failed" }
  if (-not (Get-Command telepty -ErrorAction SilentlyContinue)) { throw "telepty command not found after install" }
  $TeleptyInstalledVersion = telepty --version 2>$null
  Write-Info "telepty version: $TeleptyInstalledVersion"
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
}

if (Should-RunPhase 3 -and (Test-ComponentSelected "deliberation")) {
  Write-Header "Phase 3. Deliberation"
  Write-Info "Running canonical deliberation installer"
  npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-install
  if ($LASTEXITCODE -ne 0) { throw "Canonical deliberation installer failed" }

  Write-Info "Running deliberation doctor"
  try {
    npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-doctor
    if ($LASTEXITCODE -eq 0) { $DeliberationDoctorOk = $true; Write-Info "deliberation doctor passed" } else { Write-Warn "deliberation doctor failed" }
  } catch {
    Write-Warn "deliberation doctor failed"
  }
}

if (Should-RunPhase 4 -and (Test-ComponentSelected "brain")) {
  Write-Header "Phase 4. Brain"
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
      if ($LASTEXITCODE -eq 0) { Write-Info "aigentry-brain health check passed" } else { Write-Warn "aigentry-brain health check failed. Run 'aigentry-brain setup' for manual completion." }
    } catch {
      Write-Warn "aigentry-brain health check failed. Run 'aigentry-brain setup' for manual completion."
    }
  } else {
    Write-Warn "aigentry-brain install failed"
  }
}

if (Should-RunPhase 5 -and (Test-ComponentSelected "dustcraw")) {
  Write-Header "Phase 5. Dustcraw"
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
      if ($LASTEXITCODE -eq 0) { Write-Info "dustcraw initialized with preset '$DustcrawPreset'" } else { Write-Warn "dustcraw init failed" }
    } catch {
      Write-Warn "dustcraw init failed"
    }
    if (-not $DustcrawRunDemo) {
      if (Is-Interactive) { Prompt-Choice ([ref]$DustcrawRunDemo) "Run dustcraw demo now?" "yes" @("yes", "no") } else { $DustcrawRunDemo = "yes" }
    }
    if ((Normalize-Bool $DustcrawRunDemo) -eq "true") {
      try { dustcraw demo --non-interactive } catch { Write-Warn "dustcraw demo failed" }
    }
    if (-not $DustcrawEnableService) {
      if (Is-Interactive) { Prompt-Choice ([ref]$DustcrawEnableService) "Enable dustcraw background service now?" "no" @("yes", "no") } else { $DustcrawEnableService = "no" }
    }
    if ((Normalize-Bool $DustcrawEnableService) -eq "true") {
      Write-Warn "dustcraw service registration surface is not wired yet. Complete it in dustcraw once a stable public command is available."
    }
  } else {
    Write-Warn "dustcraw install failed or command not found"
  }
}

if (Should-RunPhase 6 -and (Test-ComponentSelected "registry-wiring")) {
  Write-Header "Phase 6. Registry Wiring"
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
    if (Invoke-RegistrySmokeTest $RegistryApiUrl $RegistryApiKey) { Write-Info "registry wiring smoke test passed" } else { Write-Warn "registry wiring smoke test failed" }
  }
}

if (Should-RunPhase 7) {
  Write-Header "Phase 7. Config Fan-Out"
  Write-InstallerState
  Write-EnvFanout
  Write-Info "Wrote installer state: $DevkitStateFile"
  Write-Info "Wrote env fan-out: $DevkitEnvFile"
}

Write-Header "Phase 8. Cross-platform Notes"
Write-Info "Manage deliberation runtime with the canonical installer surface from aigentry-deliberation."
Write-Info "Registry env fan-out is stored in $DevkitEnvFile"
Write-Info "Browser/provider auth may still require CLI restart or manual login."

Write-Header "Installation Complete!"
Write-Host ""
Write-Host "  Installed components:"
Write-Host "    Skills:     $((Get-ChildItem $skillsDest -Directory -ErrorAction SilentlyContinue | Measure-Object).Count) skills in $skillsDest"
Write-Host "    HUD:        $(Join-Path $hudDest 'simple-status.sh')"
Write-Host "    telepty:    $((if (Get-Command telepty -ErrorAction SilentlyContinue) { telepty --version 2>$null } else { 'not-installed' }))"
Write-Host "    deliberation: $((if ($DeliberationDoctorOk) { 'healthy' } else { 'not-run' }))"
Write-Host "    brain:      $((if ($BrainSelected) { 'selected' } else { 'skipped' }))"
Write-Host "    dustcraw:   $((if ($DustcrawSelected) { 'selected' } else { 'skipped' }))"
Write-Host "    registry:   $((if ($RegistryMode) { $RegistryMode } else { 'skip' }))"
Write-Host "    WTM:        $wtmDest"
Write-Host "    Config:     $ClaudeDir"
Write-Host "    State:      $DevkitStateFile"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Restart CLI processes for MCP changes to take effect"
Write-Host "    2. Dot-source $DevkitEnvFile if you want registry env in new shells"
Write-Host "    3. Run 'aigentry-brain setup' if you want full interactive brain bootstrap"
Write-Host "    4. Configure your HUD in settings.json if not already done"
