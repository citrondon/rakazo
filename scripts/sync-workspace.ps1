# Rakazo Workspace Live-Sync (Host <-> Sandbox Computer)
param (
    [ValidateSet("pull", "push", "watch")]
    [string]$Action = "pull",
    [string]$LocalDir = "C:\Users\pasca\Downloads\ssd\workspace",
    [int]$IntervalMs = 1000
)

$ErrorActionPreference = "Continue"

function Get-WorkspaceTarget {
    $api = docker ps --filter "status=running" --filter "name=rakazo-api-1" --format "{{.Names}}" | Select-Object -First 1
    if ($api) {
        $p = docker exec rakazo-api-1 sh -c 'ls -d /data/homes/team-e272d745988bd720ba0c9699ffc5de54/shared 2>/dev/null'
        if ($p -and $p.Trim()) {
            return @{ Container = "rakazo-api-1"; Path = $p.Trim() }
        }
    }
    $cId = docker ps --filter "status=running" --filter "ancestor=ghcr.io/elie222/rakazo/computer:edge" --format "{{.Names}}" | Select-Object -First 1
    if (-not $cId) {
        $cId = docker ps --filter "status=running" --filter "name=rakazo-bot-team" --format "{{.Names}}" | Select-Object -First 1
    }
    if ($cId) {
        return @{ Container = $cId.Trim(); Path = "/home/rakazo/shared" }
    }
    return $null
}

if (-not (Test-Path $LocalDir)) {
    New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
    Write-Host "[INIT] Lokaler Workspace-Ordner erstellt: $LocalDir" -ForegroundColor Cyan
}

function Get-LocalFingerprint {
    $items = Get-ChildItem -Path $LocalDir -Recurse -File -ErrorAction SilentlyContinue
    if (-not $items) { return "" }
    return ($items | ForEach-Object { "$($_.Name)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join ";"
}

function Get-RemoteFingerprint {
    param ($container, $remotePath)
    if (-not $container -or -not $remotePath) { return "" }
    try {
        $out = docker exec $container sh -c "find $remotePath -type f -printf '%f|%s|%T@\n' 2>/dev/null"
        return ($out | Out-String).Trim()
    } catch {
        return ""
    }
}

switch ($Action) {
    "pull" {
        $target = Get-WorkspaceTarget
        if (-not $target) {
            Write-Warning "Kein aktiver Rakazo-Container fuer Pull gefunden."
            return
        }
        $cName = $target.Container
        $remotePath = $target.Path
        Write-Host "[PULL] Lade Dateien aus Bot-Container ($cName, $remotePath) nach $LocalDir..." -ForegroundColor Green
        docker cp "${cName}:${remotePath}/." "$LocalDir"
        $files = Get-ChildItem -Path $LocalDir -Recurse | Where-Object { -not $_.PSIsContainer }
        Write-Host "[PULL] Fertig! $($files.Count) Datei(en) auf der Festplatte synchronisiert." -ForegroundColor Green
    }

    "push" {
        $target = Get-WorkspaceTarget
        if (-not $target) {
            Write-Warning "Kein aktiver Rakazo-Container fuer Push gefunden."
            return
        }
        $cName = $target.Container
        $remotePath = $target.Path
        Write-Host "[PUSH] Uebertrage Dateien von $LocalDir in Bot-Container ($cName, $remotePath)..." -ForegroundColor Yellow
        docker cp "$LocalDir/." "${cName}:${remotePath}/"
        docker exec rakazo-supervisor-1 chown -R 1000:1000 /data/homes 2>$null
        Write-Host "[PUSH] Fertig! Dateien stehen den Bots in $remotePath zur Verfuegung." -ForegroundColor Yellow
    }

    "watch" {
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host " Rakazo Workspace Live-Sync Daemon aktiv!" -ForegroundColor Cyan
        Write-Host " Lokaler Ordner : $LocalDir" -ForegroundColor Gray
        Write-Host "==========================================================" -ForegroundColor Cyan

        $lastLocal = Get-LocalFingerprint
        $lastRemote = ""
        $target = Get-WorkspaceTarget
        if ($target) {
            $cName = $target.Container
            $remotePath = $target.Path
            Write-Host "[SYNC] Initialer Abgleich mit $cName ($remotePath)..." -ForegroundColor DarkGray
            docker cp "${cName}:${remotePath}/." "$LocalDir"
            $lastRemote = Get-RemoteFingerprint $cName $remotePath
        } else {
            Write-Host "[SYNC] Warte auf Start eines Rakazo-Containers..." -ForegroundColor DarkGray
        }

        while ($true) {
            Start-Sleep -Milliseconds $IntervalMs
            $now = [DateTime]::Now
            $currTarget = Get-WorkspaceTarget

            if (-not $currTarget) {
                continue
            }
            $currContainer = $currTarget.Container
            $currPath = $currTarget.Path

            # 1. Host -> Bot Pruefung
            $currLocal = Get-LocalFingerprint
            if ($currLocal -ne $lastLocal) {
                Write-Host "[$($now.ToString('HH:mm:ss'))] [HOST -> BOT] Lokale Aenderung erkannt, synchronisiere..." -ForegroundColor Yellow
                try {
                    docker cp "$LocalDir/." "${currContainer}:${currPath}/"
                    docker exec rakazo-supervisor-1 chown -R 1000:1000 /data/homes 2>$null
                    $lastLocal = Get-LocalFingerprint
                    $lastRemote = Get-RemoteFingerprint $currContainer $currPath
                    Write-Host "[$($now.ToString('HH:mm:ss'))] [HOST -> BOT] Synchronisiert!" -ForegroundColor Green
                } catch {
                    Write-Warning "Fehler beim Host->Bot Sync: $_"
                }
                continue
            }

            # 2. Bot -> Host Pruefung
            $currRemote = Get-RemoteFingerprint $currContainer $currPath
            if ($currRemote -and ($currRemote -ne $lastRemote)) {
                Write-Host "[$($now.ToString('HH:mm:ss'))] [BOT -> HOST] Neue Bot-Dateien erkannt, lade auf Festplatte..." -ForegroundColor Yellow
                try {
                    docker cp "${currContainer}:${currPath}/." "$LocalDir"
                    $lastLocal = Get-LocalFingerprint
                    $lastRemote = $currRemote
                    Write-Host "[$($now.ToString('HH:mm:ss'))] [BOT -> HOST] Synchronisation abgeschlossen!" -ForegroundColor Green
                } catch {
                    Write-Warning "Fehler beim Bot->Host Sync: $_"
                }
            }
        }
    }
}

