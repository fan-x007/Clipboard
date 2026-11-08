# Clipboard Vibe - Hosts File Updater (requires elevation)
# Writes the prepared hosts content (Source) into the system hosts file
# and flushes the DNS cache.
# Usage (elevated): hosts-admin.ps1 -Source <tempFile> [-Target <hostsPath>]

param(
    [Parameter(Mandatory = $true)][string]$Source,
    [string]$Target = "$env:WINDIR\System32\drivers\etc\hosts"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) {
    throw "Source file not found: $Source"
}

Copy-Item -Path $Source -Destination $Target -Force

# Verify the copy actually landed
Start-Sleep -Milliseconds 100
$copied = [System.IO.File]::ReadAllText($Target)
$expected = [System.IO.File]::ReadAllText($Source)
if ($copied -ne $expected) {
    throw "hosts copy verification failed"
}

# Flush DNS cache so new mappings take effect immediately
$null = & ipconfig /flushdns

exit 0
