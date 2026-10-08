import type { AuthContext } from "./auth/guards.js";

export type RequestContext = {
  requestId: string;
  ip: string;
  nonce: string;
  platform: string | null;
  language: string;
  auth: () => Promise<AuthContext | null>;
  transport: "http" | "ws";
};
