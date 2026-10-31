param([string]$Pipe,[string]$Token,[int]$ParentId)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeLoader { [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr LoadLibrary(string path); }'
if ([NativeLoader]::LoadLibrary((Join-Path $env:SystemRoot 'System32\nvml.dll')) -eq [IntPtr]::Zero) { throw 'NVIDIA driver library unavailable' }
Add-Type -Path (Join-Path $PSScriptRoot 'Nvml.cs')
$uuid=[AetherNvml]::Initialize()
$dir=Join-Path $env:LOCALAPPDATA 'Aether'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file=Join-Path $dir 'gpu-recovery.json'
$lock=[IO.File]::Open((Join-Path $dir 'gpu.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$record=$null
. (Join-Path $PSScriptRoot 'gpu-curve.ps1')
function Save-Record {
  $json=$script:record | ConvertTo-Json -Depth 12
  [IO.File]::WriteAllText(($file+'.tmp'),$json)
  Move-Item -LiteralPath ($file+'.tmp') -Destination $file -Force
}
function Read-State {
  $values=@(foreach($type in @(0,2)) { foreach($state in @(0,2)) {
    try { $v=[AetherNvml]::Read($type,$state); @{type=$type; pstate=$state; value=$v.clockOffsetMHz; min=$v.minClockOffsetMHz; max=$v.maxClockOffsetMHz} } catch { }
  }})
  return @{uuid=$uuid; offsets=$values; curve=(Read-GpuCurve); temperature=[AetherNvml]::Temperature(); controlled=($null -ne $script:record -or $null -ne $script:curveRecord)}
}
function Restore-Offsets {
  $problems=@()
  try { Restore-GpuCurve } catch { $problems+=$_.Exception.Message }
  if (!$script:record) { if($problems.Count){throw ($problems -join '; ')}; return }
  if ($script:record.uuid -ne $uuid) { throw 'Recovery backup is for a different GPU' }
  foreach($entry in $script:record.offsets) {
    try {
      $now=[AetherNvml]::Read($entry.type,$entry.pstate)
      if ($now.clockOffsetMHz -eq $entry.before) { continue }
      $pendingMatch=$entry.pending -and ($now.clockOffsetMHz -eq $entry.previous -or ($entry.type -eq 2 -and [math]::Abs($now.clockOffsetMHz-$entry.after) -le 1))
      if ($now.clockOffsetMHz -ne $entry.after -and !$pendingMatch) { $problems+='Offset changed outside Aether; backup kept'; continue }
      [void][AetherNvml]::Write($entry.type,$entry.pstate,$entry.before)
    } catch { $problems+=$_.Exception.Message }
  }
  if ($problems.Count) { throw ($problems -join '; ') }
  Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
  $script:record=$null
}
$client=$null
try {
  $parent=Get-Process -Id $ParentId
  $parentStart=$parent.StartTime.ToUniversalTime().Ticks
  $client=[IO.Pipes.NamedPipeClientStream]::new('.',$Pipe,[IO.Pipes.PipeDirection]::InOut)
  $client.Connect(15000)
  $reader=[IO.StreamReader]::new($client)
  $writer=[IO.StreamWriter]::new($client); $writer.AutoFlush=$true
  $writer.WriteLine((@{token=$Token; ready=$true} | ConvertTo-Json -Compress))
  if (Test-Path -LiteralPath $file) { $script:record=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json; Restore-Offsets }
  if (Test-Path -LiteralPath $curveFile) { $script:curveRecord=Get-Content -LiteralPath $curveFile -Raw | ConvertFrom-Json; Restore-Offsets }
  while($client.IsConnected) {
    $read=$reader.ReadLineAsync()
    $deadline=[DateTime]::UtcNow.AddSeconds(20)
    while(!$read.Wait(1000)) {
      $parent.Refresh()
      if($parent.HasExited -or $parent.StartTime.ToUniversalTime().Ticks -ne $parentStart -or [DateTime]::UtcNow -gt $deadline) { throw 'Aether stopped responding; restoring GPU offsets' }
      if(($script:record -or $script:curveRecord) -and [AetherNvml]::Temperature() -ge 85) { Restore-Offsets }
    }
    $line=$read.Result
    if($null -eq $line) { break }
    $q=$line | ConvertFrom-Json
    try {
      switch($q.action) {
        'state' { $result=Read-State }
        'apply' {
          if($script:curveRecord){throw 'Restore the active GPU curve before applying clock offsets'}
          if([string]$q.core -notmatch '^-?\d+$' -or [string]$q.memory -notmatch '^-?\d+$') { throw 'Offsets must be whole MHz values' }
          $core=[int]$q.core; $memory=[int]$q.memory
          $state=Read-State
          if($state.temperature -ge 80) { throw 'GPU is too warm to change offsets (80 C limit). Cool the laptop first.' }
          foreach($v in $state.offsets) {
            $target=if($v.type -eq 0){$core}else{$memory}
            if($target -lt $v.min -or $target -gt $v.max) { throw 'Requested offset is outside the driver range' }
          }
          if(@($state.offsets | Where-Object type -eq 0).Count -eq 0 -or @($state.offsets | Where-Object type -eq 2).Count -eq 0) { throw 'GPU does not expose both clock offset domains' }
          if(!$script:record) {
            $script:record=@{uuid=$uuid; offsets=@($state.offsets | ForEach-Object { @{type=$_.type; pstate=$_.pstate; before=$_.value; after=$_.value; previous=$_.value; pending=$false} })}
          }
          foreach($entry in $script:record.offsets) {
            $now=[AetherNvml]::Read($entry.type,$entry.pstate)
            if($now.clockOffsetMHz -ne $entry.after) { throw 'An external app changed the offsets; restore or review before continuing' }
          }
          foreach($entry in $script:record.offsets) {
            $entry.previous=$entry.after; $entry.pending=$true
            $entry.after=if($entry.type -eq 0){$core}else{$memory}
            Save-Record
            $applied=[AetherNvml]::Write($entry.type,$entry.pstate,$entry.after)
            $entry.after=$applied.clockOffsetMHz
            $entry.pending=$false; Save-Record
          }
          $result=Read-State
        }
        'curve' { Apply-GpuCurve $q.millivolts $q.megahertz; $result=Read-State }
        'restore' { Restore-Offsets; $result=Read-State }
        default { throw 'Unsupported privileged operation' }
      }
      $writer.WriteLine((@{id=$q.id; ok=$true; data=$result} | ConvertTo-Json -Depth 12 -Compress))
    } catch {
      $message=$_.Exception.Message
      if($q.action -in @('apply','curve')) { try { Restore-Offsets } catch { $message+='; recovery pending: '+$_.Exception.Message } }
      $writer.WriteLine((@{id=$q.id; ok=$false; error=$message} | ConvertTo-Json -Compress))
    }
  }
} finally {
  try { Restore-Offsets } catch { [IO.File]::WriteAllText((Join-Path $dir 'gpu-recovery-error.txt'),$_.Exception.Message) }
  if($client) { $client.Dispose() }; $lock.Dispose()
}
