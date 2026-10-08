import type { NextRequest } from "next/server";
import { authPost } from "../../../../lib/auth";
export async function POST(request: NextRequest) {
  return authPost(request, "login");
}
