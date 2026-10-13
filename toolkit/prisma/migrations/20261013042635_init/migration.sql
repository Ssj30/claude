-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "Setting" (
    "shop" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "json" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("shop", "module")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'form',
    "externalId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RewardCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Review_shop_status_idx" ON "Review"("shop", "status");

-- CreateIndex
CREATE INDEX "Review_shop_productId_idx" ON "Review"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_shop_externalId_key" ON "Review"("shop", "externalId");

-- CreateIndex
CREATE INDEX "SyncLog_shop_createdAt_idx" ON "SyncLog"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardCode_shop_orderId_key" ON "RewardCode"("shop", "orderId");
