param(
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [AllowNull()][Nullable[int]]$X = $null,
    [AllowNull()][Nullable[int]]$Y = $null,
    [int]$Width = 0,
    [int]$Height = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
# 虚拟桌面外接矩形：涵盖主屏与副屏（副屏可在负坐标区）
$vx = 0; $vy = 0; $vr = 0; $vb = 0
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    $b = $s.Bounds
    if ($b.Left -lt $vx) { $vx = $b.Left }
    if ($b.Top -lt $vy) { $vy = $b.Top }
    if ($b.Right -gt $vr) { $vr = $b.Right }
    if ($b.Bottom -gt $vb) { $vb = $b.Bottom }
}
if ($vr -le $vx) { $vr = $bounds.Right }
if ($vb -le $vy) { $vb = $bounds.Bottom }

# X/Y 为 $null 才表示"未指定 → 用主屏原点"；显式负数表示副屏坐标，保留
if ($null -eq $X) { $X = $bounds.X }
if ($null -eq $Y) { $Y = $bounds.Y }
if ($Width -le 0 -or $Height -le 0) {
    $Width = $bounds.Width
    $Height = $bounds.Height
}

# 按虚拟桌面整体钳制，而不是只按主屏
if ($X -lt $vx) { $X = $vx }
if ($Y -lt $vy) { $Y = $vy }
if (($X + $Width) -gt $vr) { $Width = $vr - $X }
if (($Y + $Height) -gt $vb) { $Height = $vb - $Y }

if ($Width -le 0 -or $Height -le 0) {
    $jsonErr = @{ ok = $false; error = "region 越界：钳制后尺寸为非正数 (Width=$Width, Height=$Height, Virtual=$vx,$vy - $vr,$vb)" } | ConvertTo-Json -Compress
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
