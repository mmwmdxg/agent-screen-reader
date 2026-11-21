param(
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [int]$X = -1,
    [int]$Y = -1,
    [int]$Width = 0,
    [int]$Height = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

if ($X -lt 0 -or $Y -lt 0) {
    $X = $bounds.X
    $Y = $bounds.Y
}
if ($Width -le 0 -or $Height -le 0) {
    $Width = $bounds.Width
    $Height = $bounds.Height
}

if ($X -lt $bounds.X) { $X = $bounds.X }
if ($Y -lt $bounds.Y) { $Y = $bounds.Y }
if (($X + $Width) -gt ($bounds.X + $bounds.Width)) { $Width = $bounds.X + $bounds.Width - $X }
if (($Y + $Height) -gt ($bounds.Y + $bounds.Height)) { $Height = $bounds.Y + $bounds.Height - $Y }

if ($Width -le 0 -or $Height -le 0) {
    $jsonErr = @{ ok = $false; error = "region 越界：钳制后尺寸为非正数 (Width=$Width, Height=$Height, Screen=$($bounds.Width)x$($bounds.Height))" } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($ResultPath, $jsonErr, (New-Object System.Text.UTF8Encoding($false)))
    Write-Error "region 越界：钳制后尺寸为非正数 (Width=$Width, Height=$Height)"
    exit 1
}

$dir = Split-Path -Parent $OutputPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($Width, $Height)))
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}

$info = [ordered]@{
    ok        = $true
    path      = $OutputPath
    x         = $X
    y         = $Y
    width     = $Width
    height    = $Height
    bytes     = (Get-Item $OutputPath).Length
    capturedAt = (Get-Date).ToString('o')
}
$json = $info | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($ResultPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output $OutputPath
