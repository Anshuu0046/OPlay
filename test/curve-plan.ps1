$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../src/GpuCurve.cs')
$points=@(for($i=0;$i -lt 60;$i++){$p=[AetherCurve+Point]::new();$p.index=$i;$p.voltageUV=650000+6250*$i;$p.frequencyKHz=1000000+15000*$i;$p.deltaKHz=10000;$p})
$planned=[AetherCurve]::Plan($points,850,1500)
for($i=0;$i -lt 60;$i++) {
  $expected=if($i -lt 32){10000}else{10000+1500000-$points[$i].frequencyKHz}
  if($planned[$i] -ne $expected){throw "Wrong curve point $i"}
  if($points[$i].deltaKHz -ne 10000){throw 'Planning mutated the baseline'}
}
foreach($bad in @(@(640,1500),@(1050,1500),@(850,1499),@(850,1800),@(850,1200))) {
  $rejected=$false
  try{[void][AetherCurve]::Plan($points,$bad[0],$bad[1])}catch{$rejected=$true}
  if(!$rejected){throw 'Invalid curve target accepted'}
}
Write-Output 'PASS: native curve planner preserves baseline and lower anchors, flattens higher anchors, rejects voltage/frequency/order limits.'
