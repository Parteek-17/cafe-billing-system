import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Authorisation for route handlers.
 *
 * The role is read from public.profiles using the caller's OWN token, so an
 * attacker cannot claim a role by sending one in the request body.
 */

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Caller {
  userId: string;
  profile: Profile;
}

export async function requireUser(): Promise<Caller> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new HttpError(401, "You are not signed in.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (profileError || !profile) {
    throw new HttpError(
      403,
      "No profile row exists for this account. The owner must create one in public.profiles.",
    );
  }

  if (!profile.is_active) {
    throw new HttpError(403, "This account has been deactivated.");
  }

  return { userId: user.id, profile };
}

export async function requireAdmin(): Promise<Caller> {
  const caller = await requireUser();
  if (caller.profile.role !== "admin") {
    throw new HttpError(403, "Owner access only.");
  }
  return caller;
}

/** Turns a thrown HttpError into a JSON response; anything else is a 500. */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }

  const message = err instanceof Error ? err.message : "Unexpected error.";
  console.error("[api]", err);
  return Response.json({ error: message }, { status: 500 });
}
