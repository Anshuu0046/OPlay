param([int]$Left,[int]$Top,[int]$Width,[int]$Height,[string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$bitmap=[System.Drawing.Bitmap]::new($Width,$Height)
$g=[System.Drawing.Graphics]::FromImage($bitmap)
try {
  $g.CopyFromScreen($Left,$Top,0,0,$bitmap.Size)
  $bitmap.Save($Destination,[System.Drawing.Imaging.ImageFormat]::Png)
} catch {
  if($_.Exception.InnerException.NativeErrorCode -in @(5,6)) { [Console]::Error.WriteLine('Native desktop capture unavailable during a secure-desktop prompt.'); exit 20 }
  throw
} finally { $g.Dispose();$bitmap.Dispose() }
