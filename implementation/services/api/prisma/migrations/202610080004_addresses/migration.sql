CREATE TABLE "CustomerAddress" (
 "id" UUID PRIMARY KEY,
 "userId" UUID NOT NULL REFERENCES "IdentityUser"("id") ON DELETE RESTRICT,
 "label" VARCHAR(100) NOT NULL CHECK (length("label") BETWEEN 1 AND 100 AND "label" = btrim("label") AND "label" !~ '^[[:space:]]|[[:space:]]$'),
 "deliveryAddress" VARCHAR(500) NOT NULL CHECK (length("deliveryAddress") BETWEEN 1 AND 500 AND "deliveryAddress" = btrim("deliveryAddress") AND "deliveryAddress" !~ '^[[:space:]]|[[:space:]]$'),
 "details" VARCHAR(1000) NOT NULL CHECK (length("details") <= 1000 AND "details" = btrim("details") AND "details" !~ '^[[:space:]]|[[:space:]]$'),
 "longitude" DOUBLE PRECISION NOT NULL CHECK ("longitude" BETWEEN -180 AND 180),
 "latitude" DOUBLE PRECISION NOT NULL CHECK ("latitude" BETWEEN -90 AND 90),
 "selected" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX "CustomerAddress_userId_id_idx" ON "CustomerAddress"("userId",id);
CREATE UNIQUE INDEX "CustomerAddress_one_selected_per_owner" ON "CustomerAddress"("userId") WHERE selected;
