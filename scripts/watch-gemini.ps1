# watch-gemini.ps1
# Local Git-bus ingress watcher. Gemini and DSH share this filesystem, so this
# process observes local domain reports directly; it never fetches, merges, or
# pushes Git branches.

$ErrorActionPreference = 'Continue'

try {
    $mutex = New-Object System.Threading.Mutex($false, 'Global\dsh-local-report-watcher')
    if (-not $mutex.WaitOne(0)) {
        Write-Host 'local report watcher already running; exiting.'
        exit 0
    }
} catch {
    # Continue if the mutex is unavailable.
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$TaskDir = Join-Path $RepoRoot 'TASKS'
$PendingFile = Join-Path $TaskDir 'pending.json'
$StateFile = Join-Path $RepoRoot '.dsh\local-report-watcher-state.json'
$LogFile = Join-Path $TaskDir 'watch.log'
$Domains = @('tree', 'generation')
$RecoverySeconds = 60

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

function Read-Json([string]$Path, $Fallback) {
    if (-not (Test-Path $Path)) { return $Fallback }
    try { return Get-Content $Path -Raw | ConvertFrom-Json } catch { return $Fallback }
}

function Write-Json([string]$Path, $Value) {
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    @($Value) | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8
}

function Read-State {
    $raw = Read-Json $StateFile $null
    if ($null -eq $raw -or $null -eq $raw.reported) { return @{ reported = @() } }
    return @{ reported = @($raw.reported) }
}

function Write-State($State) {
    $State | ConvertTo-Json -Depth 6 | Set-Content -Path $StateFile -Encoding UTF8
}

function Read-Pending {
    $raw = Read-Json $PendingFile @()
    return @($raw | Where-Object {
        $_.domain -in $Domains -and
        $_.task -match '^T\d+$' -and
        $_.file -match ("^TASKS/{0}/{1}\.report\.md$" -f $_.domain, $_.task) -and
        $_.status -eq 'pending_review'
    })
}

function Write-Pending($Entries) {
    # ConvertTo-Json emits an object for one pipeline item; preserve the queue
    # contract by passing a concrete array as one input value.
    ConvertTo-Json -InputObject ([object[]]@($Entries)) -Depth 8 | Set-Content -Path $PendingFile -Encoding UTF8
}

function Get-ReportHash([string]$Path) {
    try { return (Get-FileHash -Algorithm SHA1 -Path $Path).Hash.ToLowerInvariant() } catch { return $null }
}

function Find-LocalReports {
    $reports = @()
    foreach ($domain in $Domains) {
        $domainDir = Join-Path $TaskDir $domain
        if (-not (Test-Path $domainDir)) { continue }
        $closed = @{}
        Get-ChildItem -Path $domainDir -File -Filter 'T*.closed.md' | ForEach-Object {
            if ($_.Name -match '^(T\d+)\.closed\.md$') { $closed[$Matches[1]] = $true }
        }
        Get-ChildItem -Path $domainDir -File -Filter 'T*.report.md' | ForEach-Object {
            if ($_.Name -notmatch '^(T\d+)\.report\.md$') { return }
            $task = $Matches[1]
            $spec = Get-ChildItem -Path $domainDir -File -Filter "$task-*.md" |
                Where-Object { $_.Name -notmatch '\.(report|closed)\.md$' } |
                Select-Object -First 1
            if ($null -eq $spec -or $closed.ContainsKey($task)) { return }
            $reports += [PSCustomObject]@{ domain = $domain; task = $task; file = $_.FullName }
        }
    }
    return $reports
}

$scanning = $false
function Invoke-Check {
    if ($scanning) { return }
    $script:scanning = $true
    try {
        $state = Read-State
        $seen = @($state.reported)
        # Function output is enumerated by PowerShell; re-wrap at the call site
        # so a one-record queue never degrades to a scalar PSObject.
        $pending = @(Read-Pending)
        $added = @()
        foreach ($report in @(Find-LocalReports)) {
            $hash = Get-ReportHash $report.file
            if ([string]::IsNullOrWhiteSpace($hash)) { continue }
            $relative = "TASKS/$($report.domain)/$($report.task).report.md"
            $identity = "$($report.domain)/$($report.task)|$hash"
            if ($identity -in $seen) { continue }
            if (@($pending | Where-Object { $_.reportBlob -eq $hash }).Count -gt 0) { continue }
            $pending += [PSCustomObject]@{
                domain = $report.domain
                task = $report.task
                file = $relative
                reportBlob = $hash
                remoteCommit = 'local'
                snapshot = $report.file
                sync = 'local_filesystem'
                at = (Get-Date -Format o)
                status = 'pending_review'
            }
            $added += $identity
            Write-Log "LOCAL REPORT: $relative (hash=$hash)"
        }
        if ($added.Count -gt 0) {
            Write-Pending $pending
            $state.reported = @($seen + $added)
            Write-State $state
        }
    } catch {
        Write-Log "local report scan error: $($_.Exception.Message)"
    } finally {
        $script:scanning = $false
    }
}

Invoke-Check
$watchers = @()
$subscriptions = @()
foreach ($domain in $Domains) {
    $path = Join-Path $TaskDir $domain
    if (-not (Test-Path $path)) { continue }
    $watcher = New-Object System.IO.FileSystemWatcher $path, '*.report.md'
    $watcher.IncludeSubdirectories = $false
    $watcher.EnableRaisingEvents = $true
    foreach ($eventName in @('Created', 'Changed', 'Renamed')) {
        $subscriptions += Register-ObjectEvent -InputObject $watcher -EventName $eventName
    }
    $watchers += $watcher
}

Write-Log "local report watcher started (domains=$($Domains -join ','), recovery=${RecoverySeconds}s)"
$nextRecovery = (Get-Date).AddSeconds($RecoverySeconds)
while ($true) {
    $timeout = [Math]::Max(1, [int](($nextRecovery - (Get-Date)).TotalSeconds))
    $event = Wait-Event -Timeout $timeout
    if ($null -ne $event) {
        Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
        Invoke-Check
    }
    if ((Get-Date) -ge $nextRecovery) {
        Invoke-Check
        $nextRecovery = (Get-Date).AddSeconds($RecoverySeconds)
    }
}
