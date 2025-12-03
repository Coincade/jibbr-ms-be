# Complete Migration Script

This document provides commands to copy all files from jibbr-backend to the Turborepo structure.

## PowerShell Commands (Run from jibbr-turbo-repo directory)

### 1. Copy Auth Service Files (Already done, but here for reference)

```powershell
# Controllers
Copy-Item ..\jibbr-backend\src\controllers\auth.controller.ts services\auth-service\src\controllers\

# Routes  
Copy-Item ..\jibbr-backend\src\routes\auth.route.ts services\auth-service\src\routes\
Copy-Item ..\jibbr-backend\src\routes\verify.route.ts services\auth-service\src\routes\

# Validation
Copy-Item ..\jibbr-backend\src\validation\auth.validations.ts services\auth-service\src\validation\

# Config
Copy-Item ..\jibbr-backend\src\config\mail.ts services\auth-service\src\config\
Copy-Item ..\jibbr-backend\src\config\queue.ts services\auth-service\src\config\
Copy-Item ..\jibbr-backend\src\config\rateLimit.ts services\auth-service\src\config\

# Jobs
Copy-Item -Recurse ..\jibbr-backend\src\jobs services\auth-service\src\

# Views
Copy-Item -Recurse ..\jibbr-backend\src\views services\auth-service\src\

# Helper
Copy-Item ..\jibbr-backend\src\helper.ts services\auth-service\src\
```

### 2. Copy Upload Service Files (Already done)

```powershell
# Controller
Copy-Item ..\jibbr-backend\src\routes\upload.route.ts services\upload-service\src\routes\
Copy-Item ..\jibbr-backend\src\config\upload.ts services\upload-service\src\config\
```

### 3. Copy Messaging Service Files

```powershell
# Controllers
Copy-Item ..\jibbr-backend\src\controllers\message.controller.ts services\messaging-service\src\controllers\
Copy-Item ..\jibbr-backend\src\controllers\channel.controller.ts services\messaging-service\src\controllers\
Copy-Item ..\jibbr-backend\src\controllers\conversation.controller.ts services\messaging-service\src\controllers\
Copy-Item ..\jibbr-backend\src\controllers\workspace.controller.ts services\messaging-service\src\controllers\
Copy-Item ..\jibbr-backend\src\controllers\user.controller.ts services\messaging-service\src\controllers\
Copy-Item ..\jibbr-backend\src\controllers\notification.controller.ts services\messaging-service\src\controllers\
Copy-Item ..\jibbr-backend\src\controllers\presence.controller.ts services\messaging-service\src\controllers\

# Routes
Copy-Item ..\jibbr-backend\src\routes\message.route.ts services\messaging-service\src\routes\
Copy-Item ..\jibbr-backend\src\routes\channel.route.ts services\messaging-service\src\routes\
Copy-Item ..\jibbr-backend\src\routes\conversation.route.ts services\messaging-service\src\routes\
Copy-Item ..\jibbr-backend\src\routes\workspace.route.ts services\messaging-service\src\routes\
Copy-Item ..\jibbr-backend\src\routes\user.route.ts services\messaging-service\src\routes\
Copy-Item ..\jibbr-backend\src\routes\notification.route.ts services\messaging-service\src\routes\
Copy-Item ..\jibbr-backend\src\routes\presence.route.ts services\messaging-service\src\routes\

# WebSocket
Copy-Item -Recurse ..\jibbr-backend\src\websocket services\messaging-service\src\

# Services
Copy-Item -Recurse ..\jibbr-backend\src\services services\messaging-service\src\

# Validation
Copy-Item ..\jibbr-backend\src\validation\message.validations.ts services\messaging-service\src\validation\
Copy-Item ..\jibbr-backend\src\validation\workspace.validations.ts services\messaging-service\src\validation\

# Helpers
Copy-Item -Recurse ..\jibbr-backend\src\helpers services\messaging-service\src\
Copy-Item ..\jibbr-backend\src\helper.ts services\messaging-service\src\

# Libs
Copy-Item -Recurse ..\jibbr-backend\src\libs services\messaging-service\src\

# Config
Copy-Item ..\jibbr-backend\src\config\rateLimit.ts services\messaging-service\src\config\
Copy-Item ..\jibbr-backend\src\config\redis.ts services\messaging-service\src\config\

# Middleware
Copy-Item ..\jibbr-backend\src\middleware\Role.middleware.ts services\messaging-service\src\middleware\

# Custom Types
Copy-Item ..\jibbr-backend\src\custom-types.d.ts services\messaging-service\src\
```

## After Copying - Update Imports

### In All Services:

1. **Replace Auth Middleware imports:**
   ```typescript
   // OLD
   import authMiddleware from '../middleware/Auth.middleware.js';
   
   // NEW
   import { authMiddleware } from '@jibbr/auth-middleware';
   ```

2. **Update database imports:**
   ```typescript
   // OLD
   import prisma from '../config/database.js';
   
   // NEW (should already be correct)
   import prisma from '../config/database.js';
   ```

3. **Update helper imports (if moved to shared):**
   ```typescript
   // Keep local helper.ts for service-specific helpers
   // Move common helpers to @jibbr/shared-utils
   ```

## Next Steps

1. Run the copy commands above
2. Update all imports
3. Fix any TypeScript errors
4. Test each service individually
5. Test inter-service communication

