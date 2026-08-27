[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot

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

Push-Location $projectRoot
try {
    if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
        Invoke-CheckedCommand npm.cmd ci
    }

    Invoke-CheckedCommand npm.cmd run format:check
    Invoke-CheckedCommand npm.cmd run check
    Invoke-CheckedCommand npm.cmd run build
    Invoke-CheckedCommand cargo.exe test --manifest-path src-tauri/Cargo.toml --locked
}
finally {
    Pop-Location
}
