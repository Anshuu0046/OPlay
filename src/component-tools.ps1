param([ValidateSet('Inspect','ExtractZip')][string]$Action,[string]$File,[string]$Destination,[string]$Name)
$ErrorActionPreference='Stop'
if($Action -eq 'Inspect') {
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
  $item=Get-Item -LiteralPath $File
  $signature=Get-AuthenticodeSignature -LiteralPath $File
  @{version=$item.VersionInfo.FileVersion; description=$item.VersionInfo.FileDescription; signature=$signature.Status.ToString(); signer=$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress
} else {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($File)
  try {
    $entries=@($archive.Entries | Where-Object { [IO.Path]::GetFileName($_.FullName) -ieq $Name })
    if($entries.Count -ne 1 -or $entries[0].Length -gt 268435456){throw 'Archive must contain exactly one matching runtime DLL below 256 MiB'}
    $source=$entries[0].Open(); $target=[IO.File]::Open($Destination,[IO.FileMode]::CreateNew)
    try{$source.CopyTo($target)}finally{$target.Dispose();$source.Dispose()}
  }finally{$archive.Dispose()}
}
