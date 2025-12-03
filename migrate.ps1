# Migration Script for jibbr-backend to Turborepo
# Run from jibbr-turbo-repo directory

Write-Host "Starting migration..." -ForegroundColor Green

$backendPath = "..\jibbr-backend\src"
$authServicePath = "services\auth-service\src"
$uploadServicePath = "services\upload-service\src"
$messagingServicePath = "services\messaging-service\src"

# Create directories if they don't exist
function Ensure-Directory {
    param($path)
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

Write-Host "Creating directories..." -ForegroundColor Yellow
Ensure-Directory "$authServicePath\controllers"
Ensure-Directory "$authServicePath\routes"
Ensure-Directory "$authServicePath\validation"
Ensure-Directory "$authServicePath\config"
Ensure-Directory "$authServicePath\jobs"
Ensure-Directory "$authServicePath\views"
Ensure-Directory "$uploadServicePath\controllers"
Ensure-Directory "$uploadServicePath\routes"
Ensure-Directory "$uploadServicePath\config"
Ensure-Directory "$messagingServicePath\controllers"
Ensure-Directory "$messagingServicePath\routes"
Ensure-Directory "$messagingServicePath\services"
Ensure-Directory "$messagingServicePath\validation"
Ensure-Directory "$messagingServicePath\helpers"
Ensure-Directory "$messagingServicePath\libs"
Ensure-Directory "$messagingServicePath\middleware"
Ensure-Directory "$messagingServicePath\websocket"
Ensure-Directory "$messagingServicePath\config"

Write-Host "Copying Auth Service files..." -ForegroundColor Yellow
Copy-Item "$backendPath\controllers\auth.controller.ts" "$authServicePath\controllers\" -Force
Copy-Item "$backendPath\routes\auth.route.ts" "$authServicePath\routes\" -Force
Copy-Item "$backendPath\routes\verify.route.ts" "$authServicePath\routes\" -Force
Copy-Item "$backendPath\validation\auth.validations.ts" "$authServicePath\validation\" -Force
Copy-Item "$backendPath\config\mail.ts" "$authServicePath\config\" -Force
Copy-Item "$backendPath\config\queue.ts" "$authServicePath\config\" -Force
Copy-Item "$backendPath\config\rateLimit.ts" "$authServicePath\config\" -Force
Copy-Item -Recurse "$backendPath\jobs" "$authServicePath\" -Force
Copy-Item -Recurse "$backendPath\views" "$authServicePath\" -Force
Copy-Item "$backendPath\helper.ts" "$authServicePath\" -Force

Write-Host "Copying Upload Service files..." -ForegroundColor Yellow
Copy-Item "$backendPath\routes\upload.route.ts" "$uploadServicePath\routes\" -Force
Copy-Item "$backendPath\config\upload.ts" "$uploadServicePath\config\" -Force

Write-Host "Copying Messaging Service files..." -ForegroundColor Yellow
# Controllers
Copy-Item "$backendPath\controllers\message.controller.ts" "$messagingServicePath\controllers\" -Force
Copy-Item "$backendPath\controllers\channel.controller.ts" "$messagingServicePath\controllers\" -Force
Copy-Item "$backendPath\controllers\conversation.controller.ts" "$messagingServicePath\controllers\" -Force
Copy-Item "$backendPath\controllers\workspace.controller.ts" "$messagingServicePath\controllers\" -Force
Copy-Item "$backendPath\controllers\user.controller.ts" "$messagingServicePath\controllers\" -Force
Copy-Item "$backendPath\controllers\notification.controller.ts" "$messagingServicePath\controllers\" -Force
Copy-Item "$backendPath\controllers\presence.controller.ts" "$messagingServicePath\controllers\" -Force

# Routes
Copy-Item "$backendPath\routes\message.route.ts" "$messagingServicePath\routes\" -Force
Copy-Item "$backendPath\routes\channel.route.ts" "$messagingServicePath\routes\" -Force
Copy-Item "$backendPath\routes\conversation.route.ts" "$messagingServicePath\routes\" -Force
Copy-Item "$backendPath\routes\workspace.route.ts" "$messagingServicePath\routes\" -Force
Copy-Item "$backendPath\routes\user.route.ts" "$messagingServicePath\routes\" -Force
Copy-Item "$backendPath\routes\notification.route.ts" "$messagingServicePath\routes\" -Force
Copy-Item "$backendPath\routes\presence.route.ts" "$messagingServicePath\routes\" -Force

# WebSocket
Copy-Item -Recurse "$backendPath\websocket" "$messagingServicePath\" -Force

# Services
Copy-Item -Recurse "$backendPath\services" "$messagingServicePath\" -Force

# Validation
Copy-Item "$backendPath\validation\message.validations.ts" "$messagingServicePath\validation\" -Force
Copy-Item "$backendPath\validation\workspace.validations.ts" "$messagingServicePath\validation\" -Force

# Helpers
Copy-Item -Recurse "$backendPath\helpers" "$messagingServicePath\" -Force
Copy-Item "$backendPath\helper.ts" "$messagingServicePath\" -Force

# Libs
Copy-Item -Recurse "$backendPath\libs" "$messagingServicePath\" -Force

# Config
Copy-Item "$backendPath\config\rateLimit.ts" "$messagingServicePath\config\" -Force
Copy-Item "$backendPath\config\redis.ts" "$messagingServicePath\config\" -Force

# Middleware
Copy-Item "$backendPath\middleware\Role.middleware.ts" "$messagingServicePath\middleware\" -Force

# Custom Types
Copy-Item "$backendPath\custom-types.d.ts" "$messagingServicePath\" -Force

Write-Host "Migration complete! Now update imports in the copied files." -ForegroundColor Green
Write-Host "See MIGRATE_ALL.md for import update instructions." -ForegroundColor Cyan

