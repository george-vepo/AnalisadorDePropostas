$paths = @(
  'HKCU:\Software\Policies\Microsoft\Windows\CurrentVersion\Internet Settings',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
)

$result = foreach ($path in $paths) {
  try {
    $k = Get-ItemProperty -Path $path -ErrorAction Stop
    [PSCustomObject]@{
      RegistryPath = $path
      AutoConfigURL = $k.AutoConfigURL
      ProxyEnable = $k.ProxyEnable
      ProxyServer = $k.ProxyServer
      AutoDetect = $k.AutoDetect
    }
  } catch {
    [PSCustomObject]@{
      RegistryPath = $path
      Missing = $true
    }
  }
}

$result | ConvertTo-Json -Depth 3
