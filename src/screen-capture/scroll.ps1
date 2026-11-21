param(
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [ValidateSet('scroll','scrollup','pgdn','pgup','none')][string]$Action = 'scroll',
    [int]$Amount = 1,
    [int]$X = -1,
    [int]$Y = -1
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ($Amount -lt 1) { $Amount = 1 }
if ($Amount -gt 20) { $Amount = 20 }

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$cursorExplicit = $false
if ($X -ge 0 -and $Y -ge 0) { $cursorExplicit = $true }
if (-not $cursorExplicit) {
    $X = $bounds.X + [int]($bounds.Width / 2)
    $Y = $bounds.Y + [int]($bounds.Height / 2)
}

$inputType = 'FeedInputV1' -as [type]
if (-not $inputType) {
    $src = @'
using System;
using System.Runtime.InteropServices;
public static class FeedInputV1 {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@
    Add-Type -TypeDefinition $src
}

$detail = 'none'
if ($Action -eq 'scroll' -or $Action -eq 'scrollup') {
    $moved = [FeedInputV1]::SetCursorPos($X, $Y)
    if (-not $moved) {
        $jsonErr = @{ ok = $false; error = "SetCursorPos failed: invalid coords ($X,$Y)" } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($ResultPath, $jsonErr, (New-Object System.Text.UTF8Encoding($false)))
        Write-Error "SetCursorPos failed: ($X,$Y)"
        exit 1
    }
    $delta = -120 * $Amount
    if ($Action -eq 'scrollup') { $delta = 120 * $Amount }
    $dwData = [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes([int]$delta), 0)
    [FeedInputV1]::mouse_event(0x0800, 0, 0, $dwData, [UIntPtr]::Zero)
    $detail = "wheel delta=$delta"
} elseif ($Action -eq 'pgdn' -or $Action -eq 'pgup') {
    $key = if ($Action -eq 'pgdn') { '{PGDN}' } else { '{PGUP}' }
    for ($i = 0; $i -lt $Amount; $i++) {
        [System.Windows.Forms.SendKeys]::SendWait($key)
        Start-Sleep -Milliseconds 60
    }
    $detail = "$Action x$Amount"
}

$info = [ordered]@{
    ok     = $true
    action = $Action
    amount = $Amount
    x      = $X
    y      = $Y
    detail = $detail
    at     = (Get-Date).ToString('o')
}
$json = $info | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($ResultPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output $Action
