param([Parameter(Mandatory = $true)][string]$InputFile)

$ErrorActionPreference = 'Stop'
$taskExtensionRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskInputPath = (Resolve-Path -LiteralPath $InputFile).Path
$taskPreviousKey = $env:VCAMP_LIVE_API_KEY
$taskExit = 1
try {
    if (-not $env:VCAMP_LIVE_API_KEY) {
        $taskSecret = Read-Host 'DeepSeek test API Key (masked; not saved)' -AsSecureString
        $taskSecretPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
        try { $env:VCAMP_LIVE_API_KEY = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskSecretPointer) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskSecretPointer); $taskSecret.Dispose() }
    }
    Push-Location -LiteralPath $taskExtensionRoot
    try { & node 'tests/manual/vision-live.mjs' $taskInputPath; $taskExit = $LASTEXITCODE }
    finally { Pop-Location }
}
finally { $env:VCAMP_LIVE_API_KEY = $taskPreviousKey }
exit $taskExit
