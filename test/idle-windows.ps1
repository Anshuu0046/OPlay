param([ValidateSet('Minimize','Restore')][string]$Action,[string]$StateFile)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class IdleWindow { [StructLayout(LayoutKind.Sequential)] public struct Point { public int x,y; } [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; } [StructLayout(LayoutKind.Sequential)] public struct Placement { public int length,flags,show; public Point min,max; public Rect rect; } [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h,ref Placement p); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int show); }'
if($Action -eq 'Minimize') {
  $windows=@(Get-Process | Where-Object { $_.ProcessName -in @('ChatGPT','brave') -and $_.MainWindowHandle -ne 0 } | ForEach-Object {
    $p=[IdleWindow+Placement]::new();$p.length=[Runtime.InteropServices.Marshal]::SizeOf($p)
    if([IdleWindow]::GetWindowPlacement($_.MainWindowHandle,[ref]$p)) { @{pid=$_.Id; start=$_.StartTime.ToUniversalTime().Ticks.ToString(); hwnd=$_.MainWindowHandle.ToInt64().ToString(); show=$p.show} }
  })
  $windows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StateFile
  foreach($w in $windows) { if($w.show -in @(1,3)) { [void][IdleWindow]::ShowWindowAsync([IntPtr]::new([int64]$w.hwnd),6) } }
  [Console]::WriteLine('Browser and Codex windows temporarily minimized; processes remain running.')
} else {
  if(!(Test-Path -LiteralPath $StateFile)) { return }
  $windows=Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
  foreach($w in $windows) {
    $p=Get-Process -Id $w.pid -ErrorAction SilentlyContinue
    if($p -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $w.start -and $p.MainWindowHandle.ToInt64().ToString() -eq $w.hwnd) { [void][IdleWindow]::ShowWindowAsync($p.MainWindowHandle,$w.show) }
  }
  Remove-Item -LiteralPath $StateFile
}
