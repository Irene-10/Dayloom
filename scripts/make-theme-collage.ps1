Add-Type -AssemblyName System.Drawing

$assetDir = Join-Path $PSScriptRoot '..\assets'
$items = @(
  @{ File = 'theme-yellow.png'; Label = 'Yellow' },
  @{ File = 'theme-purple.png'; Label = 'Purple' },
  @{ File = 'theme-blue.png'; Label = 'Blue' },
  @{ File = 'theme-pink.png'; Label = 'Pink' }
)

$canvas = New-Object System.Drawing.Bitmap 1200, 750
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([System.Drawing.Color]::FromArgb(247, 250, 249))
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$font = New-Object System.Drawing.Font 'Segoe UI', 15, ([System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(36, 75, 90))

for ($i = 0; $i -lt $items.Count; $i++) {
  $col = $i % 2
  $row = [Math]::Floor($i / 2)
  $x = 20 + $col * 590
  $y = 18 + $row * 365
  $graphics.DrawString($items[$i].Label, $font, $brush, $x, $y)
  $image = [System.Drawing.Image]::FromFile((Join-Path $assetDir $items[$i].File))
  $graphics.DrawImage($image, $x, ($y + 30), 570, 315)
  $image.Dispose()
}

$output = Join-Path $assetDir 'dayloom-themes.png'
$canvas.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
$brush.Dispose()
$font.Dispose()
$graphics.Dispose()
$canvas.Dispose()
Write-Output $output
