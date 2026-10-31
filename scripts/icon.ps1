Add-Type -AssemblyName System.Drawing
$dest=Join-Path $PSScriptRoot '..\src\assets'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$bitmap=[System.Drawing.Bitmap]::new(256,256)
$g=[System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode='AntiAlias'
$g.TextRenderingHint='AntiAliasGridFit'
$shape=[System.Drawing.Drawing2D.GraphicsPath]::new()
$shape.AddArc(0,0,100,100,180,90)
$shape.AddArc(155,0,100,100,270,90)
$shape.AddArc(155,155,100,100,0,90)
$shape.AddArc(0,155,100,100,90,90)
$shape.CloseFigure()
$brush=[System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Point]::new(20,0),[System.Drawing.Point]::new(210,256),[System.Drawing.Color]::FromArgb(44,53,63),[System.Drawing.Color]::FromArgb(20,26,34))
$g.FillPath($brush,$shape)
$accent=[System.Drawing.Color]::FromArgb(162,237,250)
$pen=[System.Drawing.Pen]::new($accent,10)
$g.DrawEllipse($pen,47,47,162,162)
$play=[System.Drawing.PointF[]]@([System.Drawing.PointF]::new(109,91),[System.Drawing.PointF]::new(162,128),[System.Drawing.PointF]::new(109,165))
$playBrush=[System.Drawing.SolidBrush]::new($accent)
$g.FillPolygon($playBrush,$play)
$bitmap.Save((Join-Path $dest 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$handle=$bitmap.GetHicon()
$icon=[System.Drawing.Icon]::FromHandle($handle)
$stream=[System.IO.File]::Create((Join-Path $dest 'icon.ico'))
$icon.Save($stream)
$stream.Dispose(); $icon.Dispose(); $pen.Dispose(); $playBrush.Dispose(); $brush.Dispose(); $shape.Dispose(); $g.Dispose(); $bitmap.Dispose()
