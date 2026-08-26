[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseDirectory = Join-Path $projectRoot 'src-tauri\target\release'
$executablePath = Join-Path $releaseDirectory 'hypermd.exe'
$bundleDirectory = Join-Path $releaseDirectory 'bundle'

function Assert-PathInsideProject {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $rootWithSeparator = $projectRoot.TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Caminho fora do projeto recusado: $fullPath"
    }
}

Write-Host 'Encerrando instâncias anteriores do HyperMD...'
Get-Process -Name 'hypermd' -ErrorAction SilentlyContinue | Stop-Process -Force

Assert-PathInsideProject -Path $executablePath
Assert-PathInsideProject -Path $bundleDirectory

Write-Host 'Removendo releases anteriores...'
Remove-Item -LiteralPath $executablePath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $releaseDirectory 'hypermd.pdb') -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $bundleDirectory) {
    Remove-Item -LiteralPath $bundleDirectory -Recurse -Force
}

Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    Write-Host 'Instalando dependências...'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install falhou com código $LASTEXITCODE."
    }
}

Write-Host 'Gerando o novo build release...'
& npm.cmd run tauri build -- --no-bundle
if ($LASTEXITCODE -ne 0) {
    throw "Build falhou com código $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $executablePath)) {
    throw "Build terminou sem gerar o executável esperado: $executablePath"
}

Write-Host 'Abrindo HyperMD...'
$application = Start-Process `
    -FilePath $executablePath `
    -WorkingDirectory $releaseDirectory `
    -WindowStyle Normal `
    -PassThru

# Start-Process pode retornar mesmo quando o executável falha imediatamente. Aguarda a
# inicialização da interface para que o bootstrap nunca termine reportando sucesso falso.
$ready = $application.WaitForInputIdle(10000)
$application.Refresh()
if ($application.HasExited) {
    throw "HyperMD encerrou logo após iniciar com código $($application.ExitCode)."
}
if (-not $ready) {
    Write-Warning 'O processo iniciou, mas a janela não sinalizou prontidão em 10 segundos.'
}

Write-Host "HyperMD aberto (PID $($application.Id))."
