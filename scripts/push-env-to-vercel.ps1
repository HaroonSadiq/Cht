# Pushes every value from .env to Vercel for production+preview+development.
# Run AFTER `vercel link` has associated this folder with the cht-green project.
# Usage:  pwsh -File scripts/push-env-to-vercel.ps1
#
# Skips comments + blank lines. Strips surrounding quotes. Pipes the value
# into `vercel env add` for all 3 environments via stdin so no prompts appear.

$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envFile)) { throw ".env not found at $envFile" }

$envs = @('production', 'preview', 'development')

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    # Strip a single pair of surrounding quotes if present.
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
        ($val.StartsWith("'") -and $val.EndsWith("'"))) {
        $val = $val.Substring(1, $val.Length - 2)
    }
    if (-not $val) { Write-Host "skip empty: $key" -ForegroundColor Yellow; return }

    foreach ($e in $envs) {
        Write-Host "→ $key  ($e)" -ForegroundColor Cyan
        # Remove any existing value first, ignore failure if not set yet.
        & vercel env rm $key $e --yes 2>$null | Out-Null
        # Add the new value via stdin.
        $val | & vercel env add $key $e | Out-Null
    }
}

Write-Host "`nDone. Trigger a new deploy with: vercel --prod" -ForegroundColor Green
