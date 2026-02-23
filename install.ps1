param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$DevkitDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $HOME ".claude"
$McpDest = Join-Path $HOME ".local\lib\mcp-deliberation"

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

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "   aigentry-devkit installer (PowerShell)" -ForegroundColor Cyan
Write-Host "   AI Development Environment Kit" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

Write-Header "1. Prerequisites"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Warn "node not found. Install Node.js 18+ first."
  exit 1
}
Write-Info "Node.js $(& node -v) found"

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
  Write-Warn "npm not found. Install Node.js (npm included)."
  exit 1
}

if (Get-Command tmux -ErrorAction SilentlyContinue) {
  Write-Info "tmux found (deliberation monitor can run in tmux)"
} else {
  Write-Info "tmux not found. Attempting to install..."
  $tmuxInstalled = $false
  if (Get-Command choco -ErrorAction SilentlyContinue) {
    try {
      choco install tmux -y | Out-Null
      $tmuxInstalled = $true
    } catch {}
  } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
    try {
      scoop install tmux | Out-Null
      $tmuxInstalled = $true
    } catch {}
  } elseif (Get-Command winget -ErrorAction SilentlyContinue) {
    try {
      winget install tmux --accept-source-agreements --accept-package-agreements | Out-Null
      $tmuxInstalled = $true
    } catch {}
  }
  if ($tmuxInstalled) {
    Write-Info "tmux installed successfully"
  } else {
    Write-Warn "tmux not installed. Install manually via choco/scoop/winget, or use WSL."
    Write-Warn "Deliberation monitor auto-window is disabled."
  }
}

if (Get-Command claude -ErrorAction SilentlyContinue) {
  Write-Info "Claude Code CLI found"
} else {
  Write-Warn "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
}

Write-Header "2. Skills"

$skillsDest = Join-Path $ClaudeDir "skills"
New-Item -ItemType Directory -Path $skillsDest -Force | Out-Null

$skillDirs = Get-ChildItem (Join-Path $DevkitDir "skills") -Directory
foreach ($skillDir in $skillDirs) {
  $skillName = $skillDir.Name
  $target = Join-Path $skillsDest $skillName

  if (Test-Path $target) {
    if ($Force) {
      Remove-Item -Recurse -Force $target
    } else {
      Write-Warn "$skillName already exists (skipping, use -Force to overwrite)"
      continue
    }
  }

  Copy-Item -Path $skillDir.FullName -Destination $target -Recurse
  Write-Info "Installed skill: $skillName"
}

Write-Header "3. HUD Statusline"

$hudDest = Join-Path $ClaudeDir "hud"
New-Item -ItemType Directory -Path $hudDest -Force | Out-Null
$hudTarget = Join-Path $hudDest "simple-status.sh"
$hudSource = Join-Path $DevkitDir "hud\simple-status.sh"

if (-not (Test-Path $hudTarget) -or $Force) {
  Copy-Item -Path $hudSource -Destination $hudTarget -Force
  Write-Info "Installed HUD: simple-status.sh"
} else {
  Write-Warn "HUD already exists (use -Force to overwrite)"
}

Write-Header "4. MCP Deliberation Server"

if ($Force -and (Test-Path $McpDest)) {
  Remove-Item -Path $McpDest -Recurse -Force
}
New-Item -ItemType Directory -Path $McpDest -Force | Out-Null
$mcpSource = Join-Path $DevkitDir "mcp-servers\deliberation"
Copy-Item -Path (Join-Path $mcpSource "*") -Destination $McpDest -Recurse -Force

Write-Info "Installing dependencies..."
Push-Location $McpDest
npm install --omit=dev
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  throw "npm install failed in $McpDest"
}
Pop-Location
Write-Info "MCP deliberation server installed at $McpDest"

Write-Header "5. MCP Registration"

$mcpConfig = Join-Path $ClaudeDir ".mcp.json"
New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null

$cfg = $null
if (Test-Path $mcpConfig) {
  try {
    $raw = Get-Content $mcpConfig -Raw
    if ($raw) {
      $cfg = $raw | ConvertFrom-Json
    }
  } catch {}
}
if (-not $cfg) {
  $cfg = [pscustomobject]@{}
}

if (-not ($cfg.PSObject.Properties.Match("mcpServers"))) {
  $cfg | Add-Member -MemberType NoteProperty -Name mcpServers -Value ([pscustomobject]@{})
}

$cfg.mcpServers | Add-Member -MemberType NoteProperty -Name deliberation -Value ([pscustomobject]@{
  command = "node"
  args = @((Join-Path $McpDest "index.js"))
}) -Force

$cfg | ConvertTo-Json -Depth 8 | Set-Content -Path $mcpConfig -Encoding utf8
Write-Info "Registered deliberation MCP in $mcpConfig"

if (Get-Command claude -ErrorAction SilentlyContinue) {
  $claudeScopeSupported = $false
  try {
    $claudeAddHelp = claude mcp add --help 2>$null | Out-String
    if ($claudeAddHelp -match "--scope") {
      $claudeScopeSupported = $true
    }
  } catch {}

  if ($claudeScopeSupported) {
    try { claude mcp remove --scope local deliberation 2>$null | Out-Null } catch {}
    try { claude mcp remove --scope user deliberation 2>$null | Out-Null } catch {}

    try {
      claude mcp add --scope user deliberation -- node (Join-Path $McpDest "index.js") | Out-Null
      Write-Info "Registered deliberation MCP in Claude Code user scope (~/.claude.json)"
    } catch {
      Write-Warn "Claude Code MCP registration failed. Run manually: claude mcp add --scope user deliberation -- node $McpDest\\index.js"
    }
  } else {
    try {
      claude mcp add deliberation -- node (Join-Path $McpDest "index.js") | Out-Null
      Write-Info "Registered deliberation MCP in Claude Code"
    } catch {
      Write-Warn "Claude Code MCP registration failed (legacy CLI)."
    }
  }

  try {
    $claudeMcpList = claude mcp list 2>$null | Out-String
    if ($claudeMcpList -match "(?m)^deliberation:") {
      Write-Info "Claude Code MCP verification passed (deliberation found)"
    } else {
      Write-Warn "Claude Code MCP verification failed. Restart Claude and run: claude mcp list"
    }
  } catch {
    Write-Warn "Claude Code MCP verification failed (claude mcp list unavailable)"
  }
} else {
  Write-Warn "Claude CLI not found. Skipping Claude MCP registration."
}

Write-Header "6. Config Templates"

$settingsDest = Join-Path $ClaudeDir "settings.json"
$settingsTemplate = Join-Path $DevkitDir "config\settings.json.template"
if (-not (Test-Path $settingsDest)) {
  if (Test-Path $settingsTemplate) {
    (Get-Content $settingsTemplate -Raw).Replace("{{HOME}}", $HOME) | Set-Content -Path $settingsDest -Encoding utf8
    Write-Info "Created settings.json from template"
  }
} else {
  Write-Info "settings.json already exists (skipping)"
}

if (Get-Command direnv -ErrorAction SilentlyContinue) {
  $globalEnvrc = Join-Path $HOME ".envrc"
  if (-not (Test-Path $globalEnvrc)) {
    Copy-Item -Path (Join-Path $DevkitDir "config\envrc\global.envrc") -Destination $globalEnvrc
    Write-Info "Installed global .envrc"
  } else {
    Write-Info "Global .envrc already exists (skipping)"
  }
} else {
  Write-Warn "direnv not found. Skipping .envrc setup."
}

Write-Header "7. Codex Integration (optional)"

if (Get-Command codex -ErrorAction SilentlyContinue) {
  try {
    codex mcp add deliberation -- node (Join-Path $McpDest "index.js") | Out-Null
    Write-Info "Registered deliberation MCP in Codex"
  } catch {
    Write-Warn "Codex MCP registration failed (may already exist)"
  }

  try {
    $codexList = codex mcp list 2>$null
    if ($codexList -match "deliberation") {
      Write-Info "Codex MCP verification passed (deliberation found)"
    } else {
      Write-Warn "Codex MCP verification failed. Run manually: codex mcp add deliberation -- node $McpDest\index.js"
    }
  } catch {
    Write-Warn "Codex MCP verification failed (codex mcp list unavailable)"
  }
} else {
  Write-Warn "Codex CLI not found. Skipping Codex integration."
}

Write-Header "8. Cross-platform Notes"
Write-Info "Codex is a deliberation participant CLI, not a separate MCP server."
Write-Info "Browser LLM tab detection uses macOS automation + CDP scan."
Write-Info "On Windows/Linux, start browser with --remote-debugging-port=9222 for automatic tab scan."
Write-Info "Fallback always works: prepare_turn -> paste to browser LLM -> submit_turn."

Write-Header "Installation Complete!"
Write-Host ""
Write-Host "  Installed components:"
Write-Host "    Skills:     $((Get-ChildItem $skillsDest -Directory -ErrorAction SilentlyContinue | Measure-Object).Count) skills in $skillsDest"
Write-Host "    HUD:        $hudTarget"
Write-Host "    MCP Server: $McpDest"
Write-Host "    Config:     $ClaudeDir"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Restart Claude/Codex processes to load new MCP settings"
Write-Host "    2. If browser tab scan is empty, enable browser remote debugging port"
Write-Host "    3. For updates, rerun install.ps1 -Force"
Write-Host ""
Write-Host "  Enjoy your AI development environment!"
