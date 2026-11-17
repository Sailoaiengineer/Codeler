# Asks for the Google sign-in client ID and secret and stores them in Convex.
# The secret is typed hidden and never shown or saved in a file.
Set-Location (Join-Path $PSScriptRoot '..\web')
$id = Read-Host 'Paste the Google Client ID'
$secure = Read-Host 'Paste the Google Client secret (hidden)' -AsSecureString
$secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
npx convex env set GOOGLE_CLIENT_ID $id.Trim()
npx convex env set GOOGLE_CLIENT_SECRET $secret.Trim()
$secret = $null
Write-Host 'Done. You can close this tab.'
