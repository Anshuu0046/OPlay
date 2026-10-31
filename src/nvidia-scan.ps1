Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Convert-NvidiaNumber([string]$Text) {
  $number=0.0
  if([double]::TryParse($Text.Trim(),[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$number) -and ![double]::IsNaN($number) -and ![double]::IsInfinity($number)){return $number}
  return $null
}
# shortcut: uses English NVIDIA App UIA labels; update this mapping if NVIDIA changes its controls.
function Get-NvidiaRoot {
  $expected=Join-Path ${env:ProgramFiles} 'NVIDIA Corporation\NVIDIA App\CEF\NVIDIA App.exe'
  $process=Get-Process | Where-Object { $_.ProcessName -eq 'NVIDIA App' -and $_.MainWindowHandle -ne 0 -and $_.Path -eq $expected } | Select-Object -First 1
  if(!$process) { return $null }
  return [Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
}
function Get-NvidiaElements($root) {
  return $root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
}
function Invoke-NvidiaControl($elements,[string]$name) {
  $controls=@($elements | Where-Object { $_.Current.Name -eq $name -and $_.Current.IsEnabled -and $_.Current.ControlType.ProgrammaticName -in @('ControlType.Button','ControlType.TabItem','ControlType.Hyperlink') })
  if($controls.Count -ne 1) { throw "NVIDIA control '$name' is unavailable or ambiguous. Open System > Performance in NVIDIA App." }
  $pattern=$null
  if($controls[0].TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $pattern.Invoke(); return }
  if($controls[0].TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) { $pattern.Select(); return }
  throw "NVIDIA control '$name' exposes no supported action"
}
function Get-NvidiaScan([string]$Action='Read') {
  if($Action -notin @('Read','Start','Stop','Navigate')) { throw 'Invalid NVIDIA scan operation' }
  $root=Get-NvidiaRoot
  if(!$root) { return @{available=$false; windowReady=$false; running=$false; requiresUser=$true; message='Open NVIDIA App to use its automatic GPU calibration.'} }
  $elements=Get-NvidiaElements $root
  if($Action -in @('Start','Navigate','Stop')) {
    if(@($elements | Where-Object { $_.Current.Name -eq 'TUNE NOW' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' }).Count) {
      Invoke-NvidiaControl $elements 'CLOSE'
      Start-Sleep -Milliseconds 300
      $elements=Get-NvidiaElements $root
    }
    if(!@($elements | Where-Object { $_.Current.Name -eq 'Automatic Tuning' -and $_.Current.AutomationId -match '-button$' }).Count) {
      Invoke-NvidiaControl $elements 'System'
      for($i=0;$i -lt 20;$i++) { Start-Sleep -Milliseconds 150; $elements=Get-NvidiaElements $root; if(@($elements | Where-Object { $_.Current.Name -eq 'Performance' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.TabItem' }).Count) { break } }
      Invoke-NvidiaControl $elements 'Performance'
      for($i=0;$i -lt 20;$i++) { Start-Sleep -Milliseconds 150; $elements=Get-NvidiaElements $root; if(@($elements | Where-Object { $_.Current.Name -eq 'Automatic Tuning' -and $_.Current.AutomationId -match '-button$' }).Count) { break } }
    }
  }
  $texts=@($elements | Where-Object { $_.Current.Name -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' } | ForEach-Object { $_.Current.Name })
  $switches=@($elements | Where-Object { $_.Current.Name -eq 'Automatic Tuning' -and $_.Current.AutomationId -match '-button$' })
  $running=(@($elements | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.ProgressBar' }).Count -gt 0) -or (@($texts | Where-Object { $_ -match 'Scanning|scan in progress' }).Count -gt 0)
  if($Action -eq 'Start' -and !$running) {
    for($i=0;$i -lt $texts.Count-1;$i++) { if($texts[$i] -eq 'CPU Temperature' -and (Convert-NvidiaNumber $texts[$i+1]) -ge 90) { throw 'CPU temperature is 90 C or higher. Cool the laptop or select the Efficient CPU profile before calibration.' } }
    if($switches.Count -ne 1) { throw 'Automatic tuning is not exposed in this NVIDIA App version/language. Use its Performance panel directly.' }
    if(!$switches[0].Current.IsEnabled) { throw 'NVIDIA disabled automatic tuning. Check AC power, GPU activity and its Performance panel.' }
    $learn=@($elements | Where-Object { $_.Current.Name -eq 'Automatic Tuning Learn more' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Hyperlink' })
    if($learn.Count -eq 1) {
      Invoke-NvidiaControl $elements 'Automatic Tuning Learn more'
      for($i=0;$i -lt 20;$i++) { Start-Sleep -Milliseconds 150; $elements=Get-NvidiaElements $root; if(@($elements | Where-Object { $_.Current.Name -eq 'TUNE NOW' -and $_.Current.IsEnabled }).Count) { break } }
      Invoke-NvidiaControl $elements 'TUNE NOW'
    } else {
      $pattern=[Windows.Automation.TogglePattern]$switches[0].GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)
      if($pattern.Current.ToggleState -eq [Windows.Automation.ToggleState]::On) {
        $pattern.Toggle()
        for($i=0;$i -lt 30;$i++) { Start-Sleep -Milliseconds 150; if($pattern.Current.ToggleState -eq [Windows.Automation.ToggleState]::Off -and $switches[0].Current.IsEnabled) { break } }
        if($pattern.Current.ToggleState -ne [Windows.Automation.ToggleState]::Off) { throw 'NVIDIA did not disable its old automatic profile; no scan started.' }
        Start-Sleep -Seconds 2
      }
      $pattern.Toggle()
    }
    Start-Sleep -Milliseconds 500
    $elements=Get-NvidiaElements $root
    $texts=@($elements | Where-Object { $_.Current.Name -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' } | ForEach-Object { $_.Current.Name })
    $running=(@($elements | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.ProgressBar' }).Count -gt 0) -or (@($texts | Where-Object { $_ -match 'Scanning|scan in progress' }).Count -gt 0)
  }
  if($Action -eq 'Stop' -and $running) {
    $stop=@($elements | Where-Object { $_.Current.IsEnabled -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $_.Current.Name -match '^(STOP|STOP SCAN|Stop scan|Stop)$' })
    if($stop.Count -ne 1) { throw 'NVIDIA Stop Scan control is unavailable. Stop the scan in NVIDIA App.' }
    $invoke=[Windows.Automation.InvokePattern]$stop[0].GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
  }
  $cpu=$null; $gpu=$null; $percent=$null
  for($i=0;$i -lt $texts.Count-1;$i++) {
    $number=Convert-NvidiaNumber $texts[$i+1]
    if($null -ne $number) {
      if($texts[$i] -eq 'CPU Temperature') { $cpu=$number }
      if($texts[$i] -eq 'GPU Temperature') { $gpu=$number }
    }
  }
  foreach($text in $texts) { if($text -match '^\s*(\d{1,3})\s*%\s*$') { $percent=[int]$Matches[1] } }
  $resultText=@($texts | Where-Object { $_ -match 'GPU Tuning:|VRAM Tuning:|Updated|interrupted|failed|Scanning|minutes|scan|tuning' -and $_.Length -lt 500 }) -join ' '
  $completion=$null; $reason=$null
  if(!$running -and $resultText -match 'interrupted|failed') {
    $log=Join-Path $env:LOCALAPPDATA 'NVIDIA Corporation\NVIDIA App\CxNative_NVIDIA App.log'
    if(Test-Path -LiteralPath $log) {
      $last=Get-Content -LiteralPath $log -Tail 256 -ErrorAction SilentlyContinue | Select-String 'Progress update - completionStatus : (\d+)' | Select-Object -Last 1
      if($last -and $last.Line -match 'completionStatus : (\d+)') {
        $completion=[int]$Matches[1]
        # Verified installed NVIDIA frontend flag values; unrecognized combinations remain unclassified.
        if(($completion -band 128) -ne 0) { $reason='GPU busy' }
        elseif(($completion -band 512) -ne 0) { $reason='Switched to battery power' }
        elseif(($completion -band 64) -ne 0) { $reason='Stop requested' }
      }
    }
  }
  $ready=@($elements | Where-Object { $_.Current.Name -eq 'System' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' }).Count -gt 0
  return @{available=($switches.Count -gt 0); windowReady=$ready; running=$running; requiresUser=($Action -eq 'Start' -and !$running); cpuTemperature=$cpu; gpuTemperature=$gpu; percent=$percent; message=$resultText; reason=$reason; completionStatus=$completion; source='NVIDIA App accessibility interface; optional native completion log'}
}
