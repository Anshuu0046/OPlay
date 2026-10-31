param([switch]$SkipNvml,[switch]$StayAwake)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -Path (Join-Path $PSScriptRoot 'PowerTuning.cs')
if($StayAwake) { [AetherPower]::HoldAwake() }
. (Join-Path $PSScriptRoot 'nvidia-scan.ps1')
$gpuError=$null; $gpuUuid=$null
try {
  if($SkipNvml) { throw 'Native clock queries disabled for this calibration observer' }
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeLoader { [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr LoadLibrary(string path); }'
  if ([NativeLoader]::LoadLibrary((Join-Path $env:SystemRoot 'System32\nvml.dll')) -eq [IntPtr]::Zero) { throw 'NVIDIA driver library unavailable' }
  Add-Type -Path (Join-Path $PSScriptRoot 'Nvml.cs')
  $gpuUuid=[AetherNvml]::Initialize()
} catch { $gpuError=$_.Exception.Message }
$curveError=$null
try {
  if($SkipNvml){throw 'Curve query disabled for calibration observer'}
  if([NativeLoader]::LoadLibrary((Join-Path $env:SystemRoot 'System32\nvapi64.dll')) -eq [IntPtr]::Zero){throw 'NVAPI driver library unavailable'}
  Add-Type -Path (Join-Path $PSScriptRoot 'GpuCurve.cs')
  [AetherCurve]::Initialize()
}catch{$curveError=$_.Exception.Message}
function Read-Setting($p, $n) {
  if($p -match '^POWER:([a-fA-F0-9-]{36})$') { return @{exists=$true; value=[AetherPower]::Read($Matches[1],$n); kind='PowerAC'} }
  if (!(Test-Path -LiteralPath $p)) { return @{ exists=$false; value=$null; kind=$null } }
  $k=Get-Item -LiteralPath $p
  if ($k.GetValueNames() -notcontains $n) { return @{ exists=$false; value=$null; kind=$null } }
  return @{ exists=$true; value=$k.GetValue($n); kind=$k.GetValueKind($n).ToString() }
}
function Allowed-Setting($p,$n) {
  if(($p -match '^POWER:([a-fA-F0-9-]{36})$') -and ($n -in @('MaximumProcessorState','EnergyPreference','BoostMode'))) { return $true }
  return (($p -eq 'HKCU:\Software\Microsoft\GameBar') -and ($n -in @('AutoGameModeEnabled','AllowAutoGameMode'))) -or
    (($p -eq 'HKCU:\System\GameConfigStore') -and ($n -eq 'GameDVR_Enabled')) -or
    (($p -eq 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR') -and ($n -eq 'AppCaptureEnabled')) -or
    (($p -eq 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences') -and ($n -match '^[A-Za-z]:\\.+\.exe$'))
}
while ($null -ne ($line=[Console]::ReadLine())) {
  $q=$null
  try {
    $q=$line | ConvertFrom-Json
    $result=$null
    switch ($q.action) {
      'vendorScan' { $result=Get-NvidiaScan $q.mode }
      'gpu' {
        if($gpuError) { throw $gpuError }
        $offsets=@(foreach($type in @(0,2)) { foreach($state in @(0,2)) {
          try { $v=[AetherNvml]::Read($type,$state); @{type=$type; pstate=$state; value=$v.clockOffsetMHz; min=$v.minClockOffsetMHz; max=$v.maxClockOffsetMHz} } catch { }
        }})
        $curve=@{available=$false; error=$curveError}
        if(!$curveError){try{$curve=@{available=$true; points=@([AetherCurve]::Read()); voltageUV=[AetherCurve]::VoltageUV(); controlled=$false}}catch{$curve=@{available=$false; error=$_.Exception.Message}}}
        $result=@{uuid=$gpuUuid; offsets=$offsets; curve=$curve; temperature=[AetherNvml]::Temperature()}
      }
      'inventory' {
        $computer=Get-CimInstance Win32_ComputerSystem
        $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
        $bios=Get-CimInstance Win32_BIOS | Select-Object -First 1
        $memory=@(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { @{manufacturer=$_.Manufacturer; part=$_.PartNumber.Trim(); capacity=$_.Capacity; configuredSpeed=$_.ConfiguredClockSpeed; ratedSpeed=$_.Speed} })
        $battery=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
        $steam=(Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
        if (!$steam) { $steam=(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -ErrorAction SilentlyContinue).InstallPath }
        $gog=@(foreach($key in @('HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games','HKLM:\SOFTWARE\GOG.com\Games')) {
          if(Test-Path $key) { Get-ChildItem $key | ForEach-Object { $g=Get-ItemProperty $_.PSPath; @{name=$g.gameName; path=$g.path; exe=$g.exe} } }
        })
        $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        $extra=@(foreach($branch in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
          if(Test-Path -LiteralPath $branch){foreach($entry in @(Get-ItemProperty ($branch+'\*') -ErrorAction SilentlyContinue)) {
            if(!$entry.DisplayName -or !$entry.InstallLocation -or $entry.DisplayName -match 'Battle.net|Ubisoft Connect|Ubisoft Game Launcher|^EA app$'){continue}
            $store=if($entry.Publisher -match 'Blizzard'){ 'Battle.net' }elseif($entry.Publisher -match 'Ubisoft'){ 'Ubisoft Connect' }elseif($entry.Publisher -match 'Electronic Arts'){ 'EA App' }else{$null}
            if($store){$icon=([string]$entry.DisplayIcon).Trim('"') -replace ',\d+$',''; @{name=$entry.DisplayName; store=$store; installDir=$entry.InstallLocation; executable=$icon.Trim('"')}}
          }}
        })
        $ubisoft='HKLM:\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs'
        if(Test-Path -LiteralPath $ubisoft){foreach($key in @(Get-ChildItem -LiteralPath $ubisoft)){$item=Get-ItemProperty -LiteralPath $key.PSPath; if($item.InstallDir -and $key.PSChildName -match '^\d+$'){$extra+=@{name=[IO.Path]::GetFileName($item.InstallDir.TrimEnd('\','/'));store='Ubisoft Connect';installDir=$item.InstallDir;launch=('uplay://launch/'+$key.PSChildName+'/0')}}}}
        $result=@{ model=$computer.Model; manufacturer=$computer.Manufacturer; cpu=$cpu.Name; ram=$computer.TotalPhysicalMemory; bios=$bios.SMBIOSBIOSVersion; memory=$memory;
          laptop=($battery.Count -gt 0); admin=$admin; steam=$steam; gog=$gog;
          epic=(Join-Path $env:ProgramData 'Epic\EpicGamesLauncher\Data\Manifests'); extra=$extra; graphics=@(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) }
      }
      'read' {
        if (!(Allowed-Setting $q.path $q.name)) { throw 'Setting is not allowed' }
        $result=Read-Setting $q.path $q.name
      }
      'write' {
        if (!(Allowed-Setting $q.path $q.name)) { throw 'Setting is not allowed' }
        if ($q.kind -notin @('DWord','String','ExpandString','QWord','Binary','MultiString','PowerAC')) { throw 'Unsupported registry type' }
        $current=Read-Setting $q.path $q.name
        if (($current | ConvertTo-Json -Compress) -ne ($q.expected | ConvertTo-Json -Compress)) {
          # Compare properties explicitly; JSON property order can differ.
          if (($current.exists -ne $q.expected.exists) -or ($current.kind -ne $q.expected.kind) -or (($current.value | ConvertTo-Json -Compress) -ne ($q.expected.value | ConvertTo-Json -Compress))) { throw 'Setting changed outside Aether; refresh before trying again' }
        }
        if($q.path -match '^POWER:([a-fA-F0-9-]{36})$') {
          $scheme=$Matches[1]
          if($q.kind -ne 'PowerAC' -or $q.remove -or $q.value -lt 0 -or $q.value -gt 100 -or [string]$q.value -notmatch '^\d+$') { throw 'Invalid power value' }
          [void][AetherPower]::Write($scheme,$q.name,[uint32]$q.value)
          $result=Read-Setting $q.path $q.name
          break
        }
        if (!(Test-Path -LiteralPath $q.path)) { New-Item -Path $q.path -Force | Out-Null }
        if ($q.remove) { Remove-ItemProperty -LiteralPath $q.path -Name $q.name -ErrorAction Stop }
        else { New-ItemProperty -LiteralPath $q.path -Name $q.name -Value $q.value -PropertyType $q.kind -Force | Out-Null }
        $result=Read-Setting $q.path $q.name
      }
      'processes' {
        $processes=@(Get-Process | Where-Object { $_.Id -ne $PID -and $_.WorkingSet64 -gt 0 })
        $top=@($processes | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object { @{name=$_.ProcessName; memory=[math]::Round($_.WorkingSet64/1MB); pid=$_.Id} })
        $boosted=@(); $errors=@(); $active=@()
        foreach ($p in $processes) {
          try {
            $exe=$p.Path
            if ($exe -and ($q.executables -contains $exe)) {
              $active+=@{pid=$p.Id; start=$p.StartTime.ToUniversalTime().Ticks.ToString(); path=$exe; priority=$p.PriorityClass.ToString()}
              if ($p.PriorityClass -eq 'Normal') { $p.PriorityClass='AboveNormal'; $boosted+=@{pid=$p.Id; start=$p.StartTime.ToUniversalTime().Ticks.ToString(); path=$exe; original='Normal'} }
            }
          } catch { if ($exe -and ($q.executables -contains $exe)) { $errors+=$_.Exception.Message } }
        }
        $result=@{top=$top; boosted=$boosted; active=$active; errors=$errors}
      }
      'restorePriority' {
        $done=@(); $skipped=@(); $failed=@()
        foreach($b in $q.items) {
          try {
            $p=Get-Process -Id $b.pid -ErrorAction Stop
            if (($p.StartTime.ToUniversalTime().Ticks.ToString() -eq $b.start) -and ($p.Path -eq $b.path) -and ($p.PriorityClass -eq 'AboveNormal')) { $p.PriorityClass='Normal'; $done+=$b.pid }
            else { $skipped+=$b.pid }
          } catch {
            if(Get-Process -Id $b.pid -ErrorAction SilentlyContinue) { $failed+=$b } else { $skipped+=$b.pid }
          }
        }
        $result=@{restored=$done; skipped=$skipped; failed=$failed}
      }
      'power' {
        $plan=[AetherPower]::Active()
        $result=@{scheme=$plan; max=[AetherPower]::Read($plan,'MaximumProcessorState'); epp=[AetherPower]::Read($plan,'EnergyPreference'); boost=[AetherPower]::Read($plan,'BoostMode')}
      }
      'gameRunning' {
        if(![IO.Path]::IsPathRooted([string]$q.root)){throw 'Invalid game root'}
        $prefix=([IO.Path]::GetFullPath($q.root)).TrimEnd('\')+'\'
        $result=@(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty ProcessName -Unique)
      }
      'apps' {
        $result=@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne $q.owner -and $_.Id -ne $PID -and $_.ProcessName -notmatch '^(explorer|dwm|winlogon|sihost|taskmgr|StartMenuExperienceHost|SearchHost|ShellExperienceHost|TextInputHost|ApplicationFrameHost|LockApp)$' } | ForEach-Object {
          try { if($_.Path) { @{pid=$_.Id; start=$_.StartTime.ToUniversalTime().Ticks.ToString(); name=$_.ProcessName; path=$_.Path; memory=[math]::Round($_.WorkingSet64/1MB); title=$_.MainWindowTitle} } } catch { }
        })
      }
      'closeApp' {
        $p=Get-Process -Id $q.pid
        if($p.Id -eq $PID -or $p.Id -eq $q.owner -or $p.ProcessName -match '^(explorer|dwm|winlogon|sihost|taskmgr|StartMenuExperienceHost|SearchHost|ShellExperienceHost|TextInputHost|ApplicationFrameHost|LockApp)$') { throw 'System/app process cannot be closed here' }
        if($p.StartTime.ToUniversalTime().Ticks.ToString() -ne $q.start -or $p.Path -ne $q.path) { throw 'App identity changed; refresh the list' }
        $result=@{requested=$p.CloseMainWindow(); name=$p.ProcessName; beforeMB=[math]::Round($p.WorkingSet64/1MB)}
      }
      default { throw 'Unknown action' }
    }
    @{id=$q.id; ok=$true; data=$result} | ConvertTo-Json -Compress -Depth 12 | ForEach-Object { [Console]::WriteLine($_) }
  } catch { @{id=$q.id; ok=$false; error=$_.Exception.Message} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) } }
}
