# watch-gemini.ps1
# DeepSeek-side watcher for the git-bus protocol:
# polls the GitHub remote, and when Gemini (Antigravity) has pushed a new
# TASKS/Txxx.report.md, pulls it, notifies, and writes TASKS/pending.json
# for the DSH agent to read during review.
#
# Run manually:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-gemini.ps1
# Or as a scheduled task (every 5 min):
#   schtasks /create /tn "watch-gemini" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File D:\develope\monsrise1\scripts\watch-gemini.ps1" /sc minute /mo 5
#
# ASCII-only source (PowerShell 5.1 reads BOM-less scripts as ANSI).

$ErrorActionPreference = "Continue"

# ---- single-instance guard via a named mutex (robust vs command-line matching) ----
try {
    $mutex = New-Object System.Threading.Mutex($false, "dsh-watch-gemini")
    if (-not $mutex.WaitOne(0)) {
        Write-Host "watch-gemini already running; exiting."
        exit 0
    }
} catch {
    # mutex unavailable (rare) - proceed without the guard
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $RepoRoot "TASKS\watch.log"
$PendingFile = Join-Path $RepoRoot "TASKS\pending.json"
$StateFile = Join-Path $env:TEMP "dsh-git-bus-state.json"
$IntervalSeconds = 30
$Remote = "origin"
$Branch = (& git rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($Branch -eq "" -or $Branch -eq "HEAD") { $Branch = "main" }
$RemoteRef = "$Remote/$Branch"

function Write-Log([string]$msg) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

function Show-Notification([string]$title, [string]$body) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $tip = New-Object System.Windows.Forms.NotifyIcon
        $tip.Icon = [System.Drawing.SystemIcons]::Information
        $tip.BalloonTipTitle = $title
        $tip.BalloonTipText = $body
        $tip.Visible = $true
        $tip.ShowBalloonTip(8000)
        Start-Sleep -Milliseconds 500
        $tip.Dispose()
    } catch {
        try { [console]::Beep(880, 300) } catch {}
    }
}

function Read-State {
    if (-not (Test-Path $StateFile)) { return @{} }
    try { return (Get-Content $StateFile -Raw | ConvertFrom-Json -AsHashtable) } catch { return @{} }
}

function Write-State($state) {
    $state | ConvertTo-Json -Depth 4 | Set-Content -Path $StateFile -Encoding UTF8
}

function Invoke-Git([string]$cmd) {
    Push-Location $RepoRoot
    try {
        $argList = @($cmd -split ' ')
        $out = & git @argList 2>&1
        return @{ code = $LASTEXITCODE; out = ($out -join "`n") }
    } finally { Pop-Location }
}

function Test-WorkTreeClean {
    $r = Invoke-Git "status --porcelain"
    if ($r.code -ne 0) { return $false }
    return ($r.out.Trim() -eq "")
}

function Invoke-Check {
    # fetch remote
    $fetch = Invoke-Git "fetch $Remote --prune"
    if ($fetch.code -ne 0) { Write-Log "fetch failed: $($fetch.out)"; return }

    # files changed on remote vs local under TASKS/
    $diff = Invoke-Git "diff --name-only HEAD $RemoteRef -- TASKS/"
    if ($diff.code -ne 0) { Write-Log "diff failed: $($diff.out)"; return }

    $changed = @($diff.out -split "`n" | Where-Object { $_.Trim() -ne "" })
    if ($changed.Count -eq 0) { return }

    # report files among the changes
    $reports = @($changed | Where-Object { $_ -match "TASKS/T\d+\.report\.md" })
    $state = Read-State
    $seen = @($state.reported)

    $fresh = @($reports | Where-Object { $_ -notin $seen })

    # always pull to stay current (rebase keeps history linear)
    if (-not (Test-WorkTreeClean)) {
        Write-Log "local worktree dirty, skipping pull this round"
    } else {
        $pull = Invoke-Git "pull --rebase $Remote $Branch"
        if ($pull.code -ne 0) { Write-Log "pull failed: $($pull.out)" }
    }

    if ($fresh.Count -gt 0) {
        $now = Get-Date -Format o
        $entries = @()
        foreach ($f in $fresh) {
            if ($f -match "TASKS/T(\d+)\.report\.md") { $task = "T" + $Matches[1] } else { $task = "" }
            $entries += @{ file = $f; task = $task; at = $now }
            Write-Log "NEW REPORT: $f"
        }
        Show-Notification "Gemini task done" ("New report(s): " + ($fresh -join ", "))
        # append to pending.json (merge with existing)
        $pending = @()
        if (Test-Path $PendingFile) {
            try { $pending = @(Get-Content $PendingFile -Raw | ConvertFrom-Json) } catch { $pending = @() }
        }
        $pending += $entries
        $pending | ConvertTo-Json -Depth 4 | Set-Content -Path $PendingFile -Encoding UTF8
        # remember reported files
        $state.reported = @($seen + $fresh)
        Write-State $state
    }
}

Write-Log "watch-gemini started (interval ${IntervalSeconds}s), repo: $RepoRoot"
while ($true) {
    try { Invoke-Check } catch { Write-Log "check error: $($_.Exception.Message)" }
    Start-Sleep -Seconds $IntervalSeconds
}
