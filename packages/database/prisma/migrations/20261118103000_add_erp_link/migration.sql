-- CreateTable
CREATE TABLE "ErpLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "employeeExternalId" TEXT,
    "employeeName" TEXT,
    "roleId" TEXT,
    "roleName" TEXT,
    "oauthState" TEXT,
    "oauthStateExpiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErpLink_userId_key" ON "ErpLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ErpLink_oauthState_key" ON "ErpLink"("oauthState");

-- AddForeignKey
ALTER TABLE "ErpLink" ADD CONSTRAINT "ErpLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
