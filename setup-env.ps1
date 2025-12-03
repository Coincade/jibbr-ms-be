# PowerShell script to copy root .env to all services
# Usage: .\setup-env.ps1

$rootEnv = ".env"
$services = @("auth-service", "upload-service", "messaging-service")

if (-not (Test-Path $rootEnv)) {
    Write-Host "❌ Root .env file not found at: $rootEnv" -ForegroundColor Red
    Write-Host "Please create a .env file in the root directory first." -ForegroundColor Yellow
    exit 1
}

Write-Host "📋 Copying .env to all services..." -ForegroundColor Cyan

foreach ($service in $services) {
    $targetDir = "services\$service"
    $targetFile = "$targetDir\.env"
    
    if (-not (Test-Path $targetDir)) {
        Write-Host "⚠️  Service directory not found: $targetDir" -ForegroundColor Yellow
        continue
    }
    
    Copy-Item $rootEnv $targetFile -Force
    Write-Host "✅ Copied .env to $targetFile" -ForegroundColor Green
}

Write-Host "`n✨ Done! All services now have .env files." -ForegroundColor Green
Write-Host "⚠️  Note: You may want to remove unused variables from each service's .env file." -ForegroundColor Yellow

