# watch-gemini.ps1
# DeepSeek-side git-bus watcher.
# It always fetches. New remote reports are copied from origin/<branch> into
# TASKS/inbox/ and queued in TASKS/pending.json even when the local worktree is dirty.
# A clean worktree is fast-forwarded separately; dirty work is never rebased by this watcher.
#
# Run manually:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-gemini.ps1
# Scheduled-task mode is safe too: mutex makes duplicate instances exit.
# ASCII-only source (PowerShell 5.1 reads BOM-less scripts as ANSI).

$ErrorActionPreference = "Continue"

try {
    $mutex = New-Object System.Threading.Mutex($false, "Global\dsh-watch-gemini")
    if (-not $mutex.WaitOne(0)) {
        Write-Host "watch-gemini already running; exiting."
        exit 0
    }
} catch {
    # Continue if the mutex is unavailable.
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$TaskDir = Join-Path $RepoRoot "TASKS"
$InboxDir = Join-Path $TaskDir "inbox"
$LogFile = Join-Path $TaskDir "watch.log"
$PendingFile = Join-Path $TaskDir "pending.json"
$StateFile = Join-Path $env:TEMP "dsh-git-bus-state.json"
$IntervalSeconds = 30
$Remote = "origin"

Push-Location $RepoRoot
try {
    $Branch = (& git rev-parse --abbrev-ref HEAD 2>$null).Trim()
} finally {
    Pop-Location
}
if ($Branch -eq "" -or $Branch -eq "HEAD") { $Branch = "main" }
$RemoteRef = "$Remote/$Branch"

New-Item -ItemType Directory -Path $InboxDir -Force | Out-Null

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

function Show-Notification([string]$Title, [string]$Body) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $tip = New-Object System.Windows.Forms.NotifyIcon
        $tip.Icon = [System.Drawing.SystemIcons]::Information
        $tip.BalloonTipTitle = $Title
        $tip.BalloonTipText = $Body
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

function Write-State($State) {
    $State | ConvertTo-Json -Depth 6 | Set-Content -Path $StateFile -Encoding UTF8
}

function Invoke-Git([string[]]$Args) {
    Push-Location $RepoRoot
    try {
        $out = & git @Args 2>&1
        return @{ code = $LASTEXITCODE; out = ($out -join "`n") }
    } finally {
        Pop-Location
    }
}

function Test-WorkTreeClean {
    $r = Invoke-Git @("status", "--porcelain")
    return $r.code -eq 0 -and $r.out.Trim() -eq ""
}

function Read-Pending {
    if (-not (Test-Path $PendingFile)) { return @() }
    try { return @(Get-Content $PendingFile -Raw | ConvertFrom-Json) } catch { return @() }
}

function Write-Pending($Entries) {
    @($Entries) | ConvertTo-Json -Depth 6 | Set-Content -Path $PendingFile -Encoding UTF8
}

function Save-RemoteReport([string]$Path, [string]$RemoteCommit) {
    $blob = Invoke-Git @("show", "$RemoteRef`:$Path")
    if ($blob.code -ne 0) {
        Write-Log "remote report snapshot failed for ${Path}: $($blob.out)"
        return $null
    }
    $name = Split-Path -Leaf $Path
    $snapshot = Join-Path $InboxDir ("{0}.{1}" -f $RemoteCommit.Substring(0, 12), $name)
    Set-Content -Path $snapshot -Value $blob.out -Encoding UTF8
    return $snapshot
}

function Try-FastForward([string]$RemoteCommit) {
    if (-not (Test-WorkTreeClean)) {
        Write-Log "local worktree dirty; report snapshots queued, fast-forward deferred"
        return "deferred_dirty"
    }
    $ff = Invoke-Git @("merge", "--ff-only", $RemoteRef)
    if ($ff.code -ne 0) {
        Write-Log "fast-forward failed: $($ff.out)"
        return "failed"
    }
    Write-Log "fast-forwarded local branch to $RemoteCommit"
    return "fast_forwarded"
}

function Invoke-Check {
    $fetch = Invoke-Git @("fetch", $Remote, "--prune")
    if ($fetch.code -ne 0) { Write-Log "fetch failed: $($fetch.out)"; return }

    $remoteCommitResult = Invoke-Git @("rev-parse", $RemoteRef)
    if ($remoteCommitResult.code -ne 0) { Write-Log "remote ref unavailable: $($remoteCommitResult.out)"; return }
    $remoteCommit = $remoteCommitResult.out.Trim()

    $diff = Invoke-Git @("diff", "--name-only", "HEAD", $RemoteRef, "--", "TASKS/")
    if ($diff.code -ne 0) { Write-Log "diff failed: $($diff.out)"; return }
    $changed = @($diff.out -split "`n" | Where-Object { $_.Trim() -ne "" })
    $reports = @($changed | Where-Object { $_ -match "^TASKS/T\d+\.report\.md$" })

    $state = Read-State
    $seen = @($state.reported)
    $fresh = @($reports | Where-Object { "$remoteCommit|$_" -notin $seen })

    $syncState = Try-FastForward $remoteCommit

    if ($fresh.Count -eq 0) { return }

    $now = Get-Date -Format o
    $pending = Read-Pending
    foreach ($report in $fresh) {
        $snapshot = Save-RemoteReport $report $remoteCommit
        if ($report -match "^TASKS/(T\d+)\.report\.md$") { $task = $Matches[1] } else { $task = "" }
        $pending += @{
            task = $task
            file = $report
            remoteCommit = $remoteCommit
            snapshot = $snapshot
            sync = $syncState
            at = $now
            status = "pending_review"
        }
        Write-Log "NEW REPORT: $report (snapshot=$snapshot, sync=$syncState)"
    }
    Write-Pending $pending
    $state.reported = @($seen + ($fresh | ForEach-Object { "$remoteCommit|$_" }))
    Write-State $state
    Show-Notification "Gemini task ready for review" ("Queued: " + ($fresh -join ", "))
}

Write-Log "watch-gemini started (interval ${IntervalSeconds}s, branch=$Branch)"
while ($true) {
    try { Invoke-Check } catch { Write-Log "check error: $($_.Exception.Message)" }
    Start-Sleep -Seconds $IntervalSeconds
}
