$curveFile=Join-Path $dir 'gpu-curve-recovery.json'
$curveRecord=$null; $curveError=$null
try {
  if([NativeLoader]::LoadLibrary((Join-Path $env:SystemRoot 'System32\nvapi64.dll')) -eq [IntPtr]::Zero){throw 'NVIDIA NVAPI library unavailable'}
  Add-Type -Path (Join-Path $PSScriptRoot 'GpuCurve.cs')
  [AetherCurve]::Initialize()
}catch{$curveError=$_.Exception.Message}
function Read-GpuCurve {
  if($script:curveError){return @{available=$false; error=$script:curveError}}
  try{return @{available=$true; points=@([AetherCurve]::Read()); voltageUV=[AetherCurve]::VoltageUV(); controlled=($null -ne $script:curveRecord)}}
  catch{return @{available=$false; error=$_.Exception.Message}}
}
function Restore-GpuCurve {
  if(!$script:curveRecord){return}
  if($script:curveRecord.uuid -ne $uuid){throw 'Curve backup is for another GPU'}
  $points=@([AetherCurve]::Read()); $current=@($points | ForEach-Object deltaKHz)
  if($points.Count -ne $script:curveRecord.before.Count){throw 'Curve point count changed; backup retained'}
  $beforeMatch=$true; $owned=$true
  for($i=0;$i -lt $points.Count;$i++) {
    if($points[$i].voltageUV -ne $script:curveRecord.voltages[$i]){throw 'Curve voltage map changed; backup retained'}
    if($current[$i] -ne $script:curveRecord.before[$i]){$beforeMatch=$false}
    if($current[$i] -ne $script:curveRecord.after[$i] -and !($script:curveRecord.pending -and $current[$i] -eq $script:curveRecord.before[$i])){$owned=$false}
  }
  if(!$beforeMatch){
    if(!$owned){throw 'GPU curve changed outside Aether; backup retained'}
    [AetherCurve]::Write([int[]]$current,[int[]]$script:curveRecord.before)
  }
  Remove-Item -LiteralPath $curveFile -ErrorAction Stop
  $script:curveRecord=$null
}
function Apply-GpuCurve($voltage,$frequency) {
  if($script:curveError){throw $script:curveError}
  if($script:record -or $script:curveRecord){throw 'Restore the active GPU session before applying a curve'}
  if([AetherNvml]::Temperature() -ge 80){throw 'Cool the GPU below 80 C before changing its curve'}
  if([string]$voltage -notmatch '^\d+(\.\d{1,3})?$' -or [string]$frequency -notmatch '^\d+$'){throw 'Enter a numeric voltage anchor and whole MHz frequency'}
  $millivolts=[double]::Parse([string]$voltage,[Globalization.CultureInfo]::InvariantCulture)
  $points=[AetherCurve]::Read(); $before=@($points | ForEach-Object deltaKHz)
  $after=[AetherCurve]::Plan($points,$millivolts,[int]$frequency)
  $script:curveRecord=@{uuid=$uuid; before=$before; after=@($after); voltages=@($points | ForEach-Object voltageUV); pending=$true}
  [IO.File]::WriteAllText(($curveFile+'.tmp'),($script:curveRecord | ConvertTo-Json -Depth 8))
  Move-Item -LiteralPath ($curveFile+'.tmp') -Destination $curveFile -Force
  [AetherCurve]::Write([int[]]$before,[int[]]$after)
  $script:curveRecord.pending=$false
  [IO.File]::WriteAllText(($curveFile+'.tmp'),($script:curveRecord | ConvertTo-Json -Depth 8))
  Move-Item -LiteralPath ($curveFile+'.tmp') -Destination $curveFile -Force
}
