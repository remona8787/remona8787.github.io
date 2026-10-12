param(
  [string]$SupabaseUrl = "",
  [string]$AdminSecret = ""
)

$ErrorActionPreference = "Stop"

if (-not $SupabaseUrl) {
  $SupabaseUrl = Read-Host "Supabase project URL (https://xxxx.supabase.co)"
}
if (-not $AdminSecret) {
  $secure = Read-Host "MEDIA_ADMIN_SECRET" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $AdminSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$SupabaseUrl = $SupabaseUrl.TrimEnd("/")
$cities = @(
  @{ code="SEOUL"; limit=100 },
  @{ code="TOKYO"; limit=120 },
  @{ code="NEWYORK"; limit=120 }
)

foreach ($city in $cities) {
  Write-Host ""
  Write-Host "=== Discovering $($city.code) ==="
  $body = @{
    city_code = $city.code
    limit_cities = 1
    candidate_limit_per_city = $city.limit
  } | ConvertTo-Json

  try {
    $result = Invoke-RestMethod `
      -Uri "$SupabaseUrl/functions/v1/discover-city-candidates" `
      -Method Post `
      -ContentType "application/json" `
      -Headers @{ "x-aol-media-admin-secret" = $AdminSecret } `
      -Body $body

    $result | ConvertTo-Json -Depth 12
  }
  catch {
    Write-Host "FAILED: $($city.code)" -ForegroundColor Red
    Write-Host $_
  }
}

Write-Host ""
Write-Host "Bootstrap discovery complete."
