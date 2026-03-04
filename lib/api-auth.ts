import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

interface AuthResult {
  authorized: boolean;
  isAdmin: boolean;
  userId?: string;
}

/**
 * Unified API auth: session (admin only) OR webhook secret.
 * All API endpoints use this — admin auth only.
 */
export async function requireAdmin(request: NextRequest): Promise<AuthResult> {
  // Check session — admin only
  const session = await getServerSession(authOptions);
  if (session?.user?.isAdmin) {
    return { authorized: true, isAdmin: true, userId: session.user.id };
  }

  // Check webhook secret (bot/automation)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const providedSecret = request.headers.get("X-Webhook-Secret");
  if (webhookSecret && providedSecret === webhookSecret) {
    return { authorized: true, isAdmin: true };
  }

  return { authorized: false, isAdmin: false };
}
