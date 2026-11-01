param([ValidateSet('Inspect','ExtractZip','ExtractBundle')][string]$Action,[string]$File,[string]$Destination,[string]$Name)
$ErrorActionPreference='Stop'
if($Action -eq 'Inspect') {
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
  $item=Get-Item -LiteralPath $File
  $signature=Get-AuthenticodeSignature -LiteralPath $File
  @{version=$item.VersionInfo.FileVersion; description=$item.VersionInfo.FileDescription; signature=$signature.Status.ToString(); signer=$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress
} elseif($Action -eq 'ExtractZip') {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($File)
  try {
    $entries=@($archive.Entries | Where-Object { [IO.Path]::GetFileName($_.FullName) -ieq $Name })
    if($entries.Count -ne 1 -or $entries[0].Length -gt 268435456){throw 'Archive must contain exactly one matching runtime DLL below 256 MiB'}
    $source=$entries[0].Open(); $target=[IO.File]::Open($Destination,[IO.FileMode]::CreateNew)
    try{$source.CopyTo($target)}finally{$target.Dispose();$source.Dispose()}
  }finally{$archive.Dispose()}
} else {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($File)
  try {
    if($archive.Entries.Count -gt 128){throw 'Community package has too many entries'}
    $selected=New-Object 'System.Collections.Generic.List[string]'
    [long]$total=0
    foreach($entry in $archive.Entries){
      $name=$entry.FullName
      if($name.EndsWith('/')){continue}
      $parts=$name.Split('/')
      if($parts | Where-Object {$_ -eq '.' -or $_ -eq '..' -or $_ -eq ''}){throw 'Unsafe community archive path'}
      $root=($name -cin @('dxgi.dll','OptiScaler.ini','nvngx.dll_dlssnr.dll','nvngx_dlssnr.dll'))
      $module=($name -cmatch '^OptiScaler/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.(dll|ini|cubin|bin|txt|sha256)$')
      if(-not ($root -or $module)){continue}
      if((($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960){throw 'Linked archive entries are not supported'}
      if($entry.Length -gt 536870912){throw 'Community file exceeds 512 MiB'}
      $total+=$entry.Length
      if($total -gt 2147483648){throw 'Community package expands beyond 2 GiB'}
      $target=Join-Path $Destination ($name.Replace('/','\'))
      $parent=Split-Path -Parent $target
      [IO.Directory]::CreateDirectory($parent) | Out-Null
      $inputStream=$entry.Open();$outputStream=[IO.File]::Open($target,[IO.FileMode]::CreateNew)
      try{$inputStream.CopyTo($outputStream)}finally{$outputStream.Dispose();$inputStream.Dispose()}
      $selected.Add($name)
    }
    foreach($required in @('dxgi.dll','OptiScaler.ini','nvngx_dlssnr.dll','OptiScaler/dlssg_sm86/dlssg_sm86.dll')){if(-not $selected.Contains($required)){throw "Community package is missing $required"}}
    ConvertTo-Json -InputObject $selected.ToArray() -Compress
  }finally{$archive.Dispose()}
}
