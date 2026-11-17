# Sets who may create a Codeler account (comma-separated Gmails). Run again any time to change it.
# Leave it empty to allow anyone with a Google account. People who already have an account keep it.
Set-Location (Join-Path $PSScriptRoot '..\web')
$list = Read-Host 'Gmail addresses allowed to sign up (comma-separated)'
$list = ($list -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }) -join ','
if ($list) { npx convex env set ALLOWED_EMAILS $list } else { npx convex env remove ALLOWED_EMAILS }
Write-Host "Allowed: $(if ($list) { $list } else { 'anyone' })"
