CREATE TABLE "CatalogMerchant" (
 "id" UUID PRIMARY KEY,
 "name" VARCHAR(100) NOT NULL CHECK (length("name") BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" ~ '[^[:space:]]' AND "name" !~ '^[[:space:]]|[[:space:]]$'),
 "published" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE "CatalogOutlet" (
 "id" UUID PRIMARY KEY,
 "merchantId" UUID NOT NULL REFERENCES "CatalogMerchant"("id") ON DELETE RESTRICT,
 "name" VARCHAR(100) NOT NULL CHECK (length("name") BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" ~ '[^[:space:]]' AND "name" !~ '^[[:space:]]|[[:space:]]$'),
 "currency" VARCHAR(3) NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'),
 "published" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX "CatalogOutlet_merchantId_idx" ON "CatalogOutlet"("merchantId");
CREATE INDEX "CatalogOutlet_published_id_idx" ON "CatalogOutlet"("published","id");
CREATE TABLE "CatalogCategory" (
 "id" UUID PRIMARY KEY,
 "outletId" UUID NOT NULL REFERENCES "CatalogOutlet"("id") ON DELETE RESTRICT,
 "name" VARCHAR(100) NOT NULL CHECK (length("name") BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" ~ '[^[:space:]]' AND "name" !~ '^[[:space:]]|[[:space:]]$'),
 "published" BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE ("id","outletId")
);
CREATE INDEX "CatalogCategory_outletId_published_id_idx" ON "CatalogCategory"("outletId","published","id");
CREATE TABLE "CatalogItem" (
 "id" UUID PRIMARY KEY,
 "outletId" UUID NOT NULL REFERENCES "CatalogOutlet"("id") ON DELETE RESTRICT,
 "categoryId" UUID NOT NULL,
 "name" VARCHAR(100) NOT NULL CHECK (length("name") BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" ~ '[^[:space:]]' AND "name" !~ '^[[:space:]]|[[:space:]]$'),
 "description" VARCHAR(2000) NOT NULL DEFAULT '',
 "priceMinor" INTEGER NOT NULL CHECK ("priceMinor" >= 0),
 "available" BOOLEAN NOT NULL DEFAULT TRUE,
 "published" BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY ("categoryId","outletId") REFERENCES "CatalogCategory"("id","outletId") ON DELETE RESTRICT
);
CREATE INDEX "CatalogItem_outletId_published_id_idx" ON "CatalogItem"("outletId","published","id");
CREATE INDEX "CatalogItem_categoryId_outletId_idx" ON "CatalogItem"("categoryId","outletId");
