param([Int64]$WindowHandle)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class Backdrop { [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size); }'
$value=0
$hr=[Backdrop]::DwmGetWindowAttribute([IntPtr]::new($WindowHandle),38,[ref]$value,4)
@{result=$hr; material=$value} | ConvertTo-Json -Compress
