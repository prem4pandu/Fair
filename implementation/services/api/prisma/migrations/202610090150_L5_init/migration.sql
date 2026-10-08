-- L5 order persistence. This migration is additive and safe over 001-005 and the
-- split-schema migrations: no existing table or column is rewritten.
CREATE TYPE "OrderStatus" AS ENUM ('PENDING','ACCEPTED','ASSIGNED','PICKED','DELIVERED','CANCELLED');
CREATE TYPE "OrderPaymentMethod" AS ENUM ('COD','STRIPE','PAYPAL');
CREATE TYPE "OrderPaymentStatus" AS ENUM ('PENDING','PAID','REFUNDED');
CREATE SEQUENCE "OrderNumberSeq" AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE "Order" (
  id uuid PRIMARY KEY, "orderId" varchar(40) NOT NULL UNIQUE, "orderNumber" bigint NOT NULL UNIQUE,
  "tenantId" uuid NOT NULL, "userId" uuid NOT NULL, "restaurantId" uuid NOT NULL,
  "vendorId" uuid, "zoneId" uuid, "riderId" uuid, status "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "isPickedUp" boolean NOT NULL, "paymentMethod" "OrderPaymentMethod" NOT NULL,
  "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'PENDING', "paymentReference" varchar(255),
  "currencyCode" varchar(3) NOT NULL, "currencySymbol" varchar(8) NOT NULL, "currencyExponent" smallint NOT NULL,
  "itemsMinor" bigint NOT NULL, "discountMinor" bigint NOT NULL, "deliveryMinor" bigint NOT NULL,
  "taxMinor" bigint NOT NULL, "tipMinor" bigint NOT NULL, "totalMinor" bigint NOT NULL, "paidMinor" bigint NOT NULL DEFAULT 0,
  "taxBasisPoints" integer NOT NULL, "couponId" uuid, "couponTitle" varchar(100), "couponBasisPoints" integer,
  "distanceMeters" integer, instructions varchar(500) NOT NULL DEFAULT '', reason varchar(200),
  "isRinged" boolean NOT NULL DEFAULT true, "isRiderRinged" boolean NOT NULL DEFAULT true,
  "addressId" uuid, "addressLabel" varchar(64) NOT NULL, "addressText" varchar(500) NOT NULL,
  "addressDetails" varchar(500) NOT NULL DEFAULT '', "addressLongitude" double precision, "addressLatitude" double precision,
  "restaurantName" varchar(200) NOT NULL, "restaurantSlug" varchar(200), "restaurantImage" varchar(2048),
  "restaurantAddress" varchar(500), "restaurantShopType" varchar(64),
  "restaurantLongitude" double precision NOT NULL, "restaurantLatitude" double precision NOT NULL,
  "customerName" varchar(200) NOT NULL, "customerEmail" varchar(254), "customerPhone" varchar(32),
  "riderName" varchar(200), "riderUsername" varchar(100), "riderPhone" varchar(32),
  "orderDate" timestamptz(3) NOT NULL, "expectedTime" timestamptz(3), "visibleAt" timestamptz(3),
  "acceptDeadlineAt" timestamptz(3), "acceptedAt" timestamptz(3), "assignedAt" timestamptz(3),
  "pickedAt" timestamptz(3), "deliveredAt" timestamptz(3), "cancelledAt" timestamptz(3), "paidAt" timestamptz(3),
  "preparationTime" timestamptz(3), "selectedPrepTime" smallint, "completionTime" timestamptz(3),
  version integer NOT NULL DEFAULT 1, "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "updatedAt" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "Order_money_nonnegative" CHECK ("itemsMinor">=0 AND "discountMinor">=0 AND "deliveryMinor">=0 AND "taxMinor">=0 AND "tipMinor">=0 AND "totalMinor">=0 AND "paidMinor">=0 AND "discountMinor"<="itemsMinor"),
  CONSTRAINT "Order_total_balanced" CHECK ("totalMinor"="itemsMinor"-"discountMinor"+"deliveryMinor"+"taxMinor"+"tipMinor"),
  CONSTRAINT "Order_pickup_free" CHECK (NOT "isPickedUp" OR ("deliveryMinor"=0 AND "tipMinor"=0)),
  CONSTRAINT "Order_currency_exponent" CHECK ("currencyExponent" BETWEEN 0 AND 3),
  CONSTRAINT "Order_version_positive" CHECK (version>=1),
  CONSTRAINT "Order_tax_basis_points" CHECK ("taxBasisPoints" BETWEEN 0 AND 10000),
  CONSTRAINT "Order_coupon_basis_points" CHECK ("couponBasisPoints" IS NULL OR "couponBasisPoints" BETWEEN 0 AND 10000),
  CONSTRAINT "Order_status_timestamps" CHECK (
    (status<>'ACCEPTED' OR "acceptedAt" IS NOT NULL) AND
    (status<>'ASSIGNED' OR ("assignedAt" IS NOT NULL AND "riderId" IS NOT NULL)) AND
    (status<>'PICKED' OR "pickedAt" IS NOT NULL) AND
    (status<>'DELIVERED' OR "deliveredAt" IS NOT NULL) AND
    (status<>'CANCELLED' OR "cancelledAt" IS NOT NULL))
);

CREATE TABLE "OrderItem" (
 id uuid PRIMARY KEY, "orderId" uuid NOT NULL REFERENCES "Order"(id) ON DELETE RESTRICT, position smallint NOT NULL,
 "foodId" uuid NOT NULL, title varchar(200) NOT NULL, description varchar(1000), image varchar(2048), quantity smallint NOT NULL,
 "specialInstructions" varchar(500) NOT NULL DEFAULT '', "variationId" uuid NOT NULL, "variationTitle" varchar(200) NOT NULL,
 "variationPriceMinor" bigint NOT NULL, "variationDiscountedMinor" bigint NOT NULL DEFAULT 0,
 "unitPriceMinor" bigint NOT NULL, "lineTotalMinor" bigint NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
 UNIQUE("orderId",position), CHECK(quantity BETWEEN 1 AND 99),
 CHECK("variationPriceMinor">=0 AND "variationDiscountedMinor">=0 AND "unitPriceMinor">="variationPriceMinor" AND "lineTotalMinor"="unitPriceMinor"*quantity)
);
CREATE TABLE "OrderItemAddon" (
 id uuid PRIMARY KEY, "orderItemId" uuid NOT NULL REFERENCES "OrderItem"(id) ON DELETE RESTRICT, position smallint NOT NULL,
 "addonId" uuid NOT NULL, title varchar(200) NOT NULL, description varchar(1000), "quantityMinimum" smallint NOT NULL,
 "quantityMaximum" smallint NOT NULL, UNIQUE("orderItemId",position), CHECK("quantityMinimum">=0 AND "quantityMaximum">="quantityMinimum")
);
CREATE TABLE "OrderItemOption" (
 id uuid PRIMARY KEY, "orderItemAddonId" uuid NOT NULL REFERENCES "OrderItemAddon"(id) ON DELETE RESTRICT, position smallint NOT NULL,
 "optionId" uuid NOT NULL, title varchar(200) NOT NULL, description varchar(1000), "priceMinor" bigint NOT NULL,
 UNIQUE("orderItemAddonId",position), CHECK("priceMinor">=0)
);
CREATE TABLE "OrderStatusHistory" (
 id uuid PRIMARY KEY, "orderId" uuid NOT NULL REFERENCES "Order"(id) ON DELETE RESTRICT,
 "fromStatus" "OrderStatus", "toStatus" "OrderStatus" NOT NULL, "actorType" varchar(16) NOT NULL,
 "actorId" varchar(64) NOT NULL, reason varchar(200), "riderId" uuid, version integer NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT now(), UNIQUE("orderId",version)
);
CREATE TABLE "OrderEta" (
 "orderId" uuid PRIMARY KEY REFERENCES "Order"(id) ON DELETE RESTRICT, phase varchar(32) NOT NULL, source varchar(32) NOT NULL,
 "readyAt" timestamptz(3), "baseArrivalAt" timestamptz(3), "estimatedArrivalAt" timestamptz(3),
 "windowStartAt" timestamptz(3), "windowEndAt" timestamptz(3), "durationSeconds" integer, "distanceMeters" integer,
 "encodedPolyline" text, "originLatitude" double precision, "originLongitude" double precision,
 "destinationLatitude" double precision, "destinationLongitude" double precision, "calculatedAt" timestamptz(3) NOT NULL,
 "lastLocationAt" timestamptz(3), version integer NOT NULL DEFAULT 1
);

CREATE INDEX "Order_tenant_user_created_idx" ON "Order"("tenantId","userId","createdAt" DESC);
CREATE INDEX "Order_tenant_restaurant_created_idx" ON "Order"("tenantId","restaurantId","createdAt" DESC);
CREATE INDEX "Order_tenant_rider_status_idx" ON "Order"("tenantId","riderId",status);
CREATE INDEX "Order_tenant_status_deadline_idx" ON "Order"("tenantId",status,"acceptDeadlineAt");
CREATE INDEX "OrderItem_food_idx" ON "OrderItem"("foodId");
CREATE INDEX "OrderStatusHistory_order_created_idx" ON "OrderStatusHistory"("orderId","createdAt");

CREATE FUNCTION l5_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'OrderStatusHistory is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER "OrderStatusHistory_append_only" BEFORE UPDATE OR DELETE ON "OrderStatusHistory"
FOR EACH ROW EXECUTE FUNCTION l5_history_immutable();

-- The only supported status mutation. It locks the aggregate, enforces tenant,
-- actor, fulfillment and optimistic version rules, and appends history + outbox.
CREATE FUNCTION l5_transition_order(
 p_tenant uuid, p_order uuid, p_target "OrderStatus", p_actor_type varchar,
 p_actor_id varchar, p_expected_version integer, p_reason varchar DEFAULT NULL,
 p_rider_id uuid DEFAULT NULL, p_prep_minutes integer DEFAULT NULL
) RETURNS TABLE(result text, version integer) LANGUAGE plpgsql AS $$
DECLARE o "Order"%ROWTYPE; allowed boolean := false; next_version integer;
BEGIN
 SELECT * INTO o FROM "Order" WHERE id=p_order AND "tenantId"=p_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'L5_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF o.status=p_target AND (p_target<>'ASSIGNED' OR p_rider_id IS NULL OR o."riderId"=p_rider_id) THEN
   RETURN QUERY SELECT 'NOOP'::text,o.version; RETURN;
 END IF;
 IF o.version<>p_expected_version THEN RAISE EXCEPTION 'L5_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 allowed :=
   (o.status='PENDING' AND p_target='ACCEPTED' AND p_actor_type IN ('RESTAURANT','ADMIN')) OR
   (o.status='PENDING' AND p_target='CANCELLED' AND p_actor_type IN ('CUSTOMER','RESTAURANT','ADMIN','SYSTEM')) OR
   (NOT o."isPickedUp" AND o.status='ACCEPTED' AND p_target='ASSIGNED' AND p_actor_type IN ('RIDER','ADMIN')) OR
   (NOT o."isPickedUp" AND o.status='ASSIGNED' AND p_target='ASSIGNED' AND p_actor_type='ADMIN') OR
   (NOT o."isPickedUp" AND o.status='ASSIGNED' AND p_target='PICKED' AND p_actor_type IN ('RIDER','ADMIN')) OR
   (NOT o."isPickedUp" AND o.status='PICKED' AND p_target='DELIVERED' AND p_actor_type IN ('RIDER','ADMIN')) OR
   (o."isPickedUp" AND o.status='ACCEPTED' AND p_target='DELIVERED' AND p_actor_type IN ('RESTAURANT','ADMIN')) OR
   (o.status IN ('ACCEPTED','ASSIGNED','PICKED') AND p_target='CANCELLED' AND p_actor_type='ADMIN');
 IF NOT allowed THEN RAISE EXCEPTION 'L5_TRANSITION_NOT_ALLOWED' USING ERRCODE='P0001'; END IF;
 IF p_target='ACCEPTED' AND (p_prep_minutes IS NULL OR p_prep_minutes NOT BETWEEN 1 AND 180) THEN RAISE EXCEPTION 'L5_PREP_TIME_REQUIRED' USING ERRCODE='22023'; END IF;
 IF p_target='ASSIGNED' AND COALESCE(p_rider_id,o."riderId") IS NULL THEN RAISE EXCEPTION 'L5_RIDER_REQUIRED' USING ERRCODE='22023'; END IF;
 next_version:=o.version+1;
 UPDATE "Order" SET status=p_target, version=next_version, "updatedAt"=now(),
   "acceptDeadlineAt"=CASE WHEN p_target='PENDING' THEN "acceptDeadlineAt" ELSE NULL END,
   "isRinged"=CASE WHEN p_target IN ('ACCEPTED','CANCELLED') THEN false ELSE "isRinged" END,
   "riderId"=CASE WHEN p_target='ASSIGNED' THEN COALESCE(p_rider_id,"riderId") ELSE "riderId" END,
   "isRiderRinged"=CASE WHEN p_target='ASSIGNED' THEN false ELSE "isRiderRinged" END,
   "acceptedAt"=CASE WHEN p_target='ACCEPTED' THEN now() ELSE "acceptedAt" END,
   "selectedPrepTime"=CASE WHEN p_target='ACCEPTED' THEN p_prep_minutes ELSE "selectedPrepTime" END,
   "preparationTime"=CASE WHEN p_target='ACCEPTED' THEN now()+make_interval(mins=>p_prep_minutes) ELSE "preparationTime" END,
   "assignedAt"=CASE WHEN p_target='ASSIGNED' THEN now() ELSE "assignedAt" END,
   "pickedAt"=CASE WHEN p_target='PICKED' THEN now() ELSE "pickedAt" END,
   "deliveredAt"=CASE WHEN p_target='DELIVERED' THEN now() ELSE "deliveredAt" END,
   "completionTime"=CASE WHEN p_target='DELIVERED' THEN now() ELSE "completionTime" END,
   "cancelledAt"=CASE WHEN p_target='CANCELLED' THEN now() ELSE "cancelledAt" END,
   reason=CASE WHEN p_target='CANCELLED' THEN p_reason ELSE reason END,
   "paymentStatus"=CASE WHEN p_target='DELIVERED' AND "paymentMethod"='COD' THEN 'PAID' ELSE "paymentStatus" END,
   "paidMinor"=CASE WHEN p_target='DELIVERED' AND "paymentMethod"='COD' THEN "totalMinor" ELSE "paidMinor" END,
   "paidAt"=CASE WHEN p_target='DELIVERED' AND "paymentMethod"='COD' THEN now() ELSE "paidAt" END
 WHERE id=p_order;
 INSERT INTO "OrderStatusHistory"(id,"orderId","fromStatus","toStatus","actorType","actorId",reason,"riderId",version)
 VALUES(gen_random_uuid(),p_order,o.status,p_target,p_actor_type,p_actor_id,p_reason,COALESCE(p_rider_id,o."riderId"),next_version);
 INSERT INTO "DomainEvent"(id,type,payload) VALUES(gen_random_uuid(),'order.transitioned',jsonb_build_object(
   'from',o.status::text,'to',p_target::text,'actor',jsonb_build_object('type',p_actor_type,'id',p_actor_id),
   'reason',p_reason,'order',jsonb_build_object(
     'id',p_order,'orderId',o."orderId",'status',p_target::text,'restaurantId',o."restaurantId",'userId',o."userId",
     'riderId',CASE WHEN p_target='ASSIGNED' THEN COALESCE(p_rider_id,o."riderId") ELSE o."riderId" END,
     'zoneId',o."zoneId",'isPickedUp',o."isPickedUp",'paymentMethod',o."paymentMethod"::text,
     'paymentStatus',CASE WHEN p_target='DELIVERED' AND o."paymentMethod"='COD' THEN 'PAID' ELSE o."paymentStatus"::text END,
     'currency',jsonb_build_object('code',o."currencyCode",'symbol',o."currencySymbol",'exponent',o."currencyExponent"),
     'itemsMinor',o."itemsMinor"::text,'discountMinor',o."discountMinor"::text,'deliveryMinor',o."deliveryMinor"::text,
     'taxMinor',o."taxMinor"::text,'tipMinor',o."tipMinor"::text,'totalMinor',o."totalMinor"::text,
     'version',next_version,'createdAt',o."createdAt",'acceptedAt',CASE WHEN p_target='ACCEPTED' THEN now() ELSE o."acceptedAt" END)));
 RETURN QUERY SELECT 'APPLIED'::text,next_version;
END $$;
