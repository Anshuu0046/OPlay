$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../src/nvidia-scan.ps1')
if((Convert-NvidiaNumber ' 94.5 ') -ne 94.5){throw 'Numeric temperature failed'}
if((Convert-NvidiaNumber '0') -ne 0){throw 'Zero temperature must remain a number'}
foreach($text in @('N/A','--','CPU Temperature','','NaN','Infinity')){if($null -ne (Convert-NvidiaNumber $text)){throw "Non-numeric sensor accepted: $text"}}
if((Convert-NvidiaNumber 'N/A') -ge 90){throw 'Unavailable temperature must not be treated as a measured hot sensor'}
if(!((Convert-NvidiaNumber '95') -ge 90)){throw 'Hot measured CPU must retain its calibration gate'}
Write-Output 'PASS: NVIDIA numeric sensors, unavailable labels, zero and non-finite values; thermal gate preserved without format exceptions.'
