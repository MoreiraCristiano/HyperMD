[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw "The HyperMD NSIS installer can only be built on Windows."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$installerDirectory = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
$temporaryConfig = $null

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

$existingInstallers = @{}
if (Test-Path $installerDirectory) {
    Get-ChildItem -Path $installerDirectory -Filter "*-setup.exe" -File | ForEach-Object {
        $existingInstallers[$_.FullName] = "{0}:{1}" -f $_.Length, $_.LastWriteTimeUtc.Ticks
    }
}

Push-Location $projectRoot
try {
    if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
        Invoke-CheckedCommand npm.cmd ci
    }

    $tauriArguments = @("run", "tauri", "--", "build", "--bundles", "nsis", "--ci")

    if ($Version) {
        $temporaryConfig = Join-Path ([System.IO.Path]::GetTempPath()) "hypermd-tauri-$([guid]::NewGuid().ToString('N')).json"
        @{ version = $Version } | ConvertTo-Json -Compress | Set-Content -Path $temporaryConfig -Encoding utf8
        $tauriArguments += @("--config", $temporaryConfig)
    }

    Invoke-CheckedCommand npm.cmd @tauriArguments

    $producedInstallers = @(
        Get-ChildItem -Path $installerDirectory -Filter "*-setup.exe" -File | Where-Object {
            $signature = "{0}:{1}" -f $_.Length, $_.LastWriteTimeUtc.Ticks
            -not $existingInstallers.ContainsKey($_.FullName) -or $existingInstallers[$_.FullName] -ne $signature
        }
    )

    if ($producedInstallers.Count -ne 1) {
        throw "Expected exactly one NSIS installer from this build, but found $($producedInstallers.Count)."
    }

    Write-Output $producedInstallers[0].FullName
}
finally {
    if ($temporaryConfig -and (Test-Path $temporaryConfig)) {
        Remove-Item -LiteralPath $temporaryConfig -Force
    }

    Pop-Location
}
