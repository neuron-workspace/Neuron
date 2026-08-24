<#
.SYNOPSIS
  Create a self-signed code-signing certificate for Neuron.

.DESCRIPTION
  Two jobs, and it is worth being precise about which is which:

  1. Test-installing the .appx before submitting it to the Microsoft Store.
     Windows refuses to install an MSIX/APPX whose signature it cannot chain to
     a trusted root, so you cannot check your own Store package without one.
     THIS IS THE JOB THAT MATTERS. Partner Center re-signs the package on
     submission, so Store users never see this certificate.

  2. Signing the NSIS installer published on GitHub Releases.
     Be clear-eyed about what this buys: nothing, against a determined attacker.
     A self-signed certificate has no trust anchor, so anyone who tampers with
     the installer can re-sign it with their own certificate bearing the same
     subject name and Windows will present it identically. It does not remove
     the SmartScreen warning either.

     If what you want is "prove this binary is the one CI built", the release
     workflow publishes SHA-256 checksums and a signed build-provenance
     attestation. Those are verifiable by anyone with `gh attestation verify`,
     and unlike a self-signed certificate they cannot be forged by re-signing.

  The subject CN must match the appx `publisher` field EXACTLY, or the package
  will build and then refuse to install with a signature mismatch.

.EXAMPLE
  # Read the publisher from package.json and generate a 3-year certificate:
  .\tools\make-signing-cert.ps1

.EXAMPLE
  .\tools\make-signing-cert.ps1 -Publisher "CN=1234ABCD-5678-..." -Password "s3cret"
#>
[CmdletBinding()]
param(
  [string]$Publisher,
  [string]$Password,
  [string]$OutFile = "neuron-signing.pfx",
  [int]$YearsValid = 3
)

$ErrorActionPreference = 'Stop'

if (-not $Publisher) {
  $pkg = Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json
  $Publisher = $pkg.build.appx.publisher
  Write-Host "Publisher from package.json: $Publisher"
}

if ($Publisher -like '*REPLACE*') {
  Write-Error @"
The appx publisher in package.json is still a placeholder.

Get the real values from Partner Center:
  Partner Center -> your app -> Product management -> Product identity

Copy three fields into package.json under build.appx:
  identityName        <- 'Package/Identity/Name'
  publisher           <- 'Package/Identity/Publisher'  (the full CN=... string)
  publisherDisplayName<- 'Package/Properties/PublisherDisplayName'

Then run this script again.
"@
}

if (-not $Password) {
  $secure = Read-Host -AsSecureString "Password to protect $OutFile"
} else {
  $secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
}

Write-Host "Creating a code-signing certificate for $Publisher ..."
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Publisher `
  -KeyUsage DigitalSignature `
  -FriendlyName "Neuron self-signed code signing" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears($YearsValid) `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

$path = Join-Path (Get-Location) $OutFile
Export-PfxCertificate -Cert $cert -FilePath $path -Password $secure | Out-Null

Write-Host ""
Write-Host "Wrote $path"
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host ""
Write-Host "To test-install the .appx on THIS machine, trust the certificate first"
Write-Host "(an elevated prompt -- this adds it to the machine's trusted roots):"
Write-Host ""
Write-Host "  Import-PfxCertificate -FilePath '$path' -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password (Read-Host -AsSecureString)"
Write-Host ""
Write-Host "To use it in CI, add these two repository secrets:"
Write-Host "  WINDOWS_CERT_BASE64   = the line printed below"
Write-Host "  WINDOWS_CERT_PASSWORD = the password you just chose"
Write-Host ""
Write-Host "--- WINDOWS_CERT_BASE64 ---"
[Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
Write-Host "--- end ---"
Write-Host ""
Write-Warning "$OutFile is a private key. Do not commit it. It is gitignored by name."
