export interface SessionValidator {
  isActive(sessionId: string): Promise<boolean>;
}

export const SESSION_VALIDATOR = Symbol("SESSION_VALIDATOR");

export interface PrincipalLoader {
  load(
    userId: string,
    type: string,
  ): Promise<{
    permissions: string[];
    restaurantIds: string[];
    vendorId: string | null;
    riderId: string | null;
  } | null>;
}

export const PRINCIPAL_LOADER = Symbol("PRINCIPAL_LOADER");
