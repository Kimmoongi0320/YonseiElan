import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getSupabaseServerClient } from "./supabase/server";

const PIN_HASH_KEY = "admin_pin_hash";
const DEFAULT_PIN = "1234";
const SCRYPT_KEYLEN = 32;

function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${derived}`;
}

function verifyHash(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN);
  if (derived.length !== expected.length) return false;

  return timingSafeEqual(derived, expected);
}

export async function verifyAdminPin(pin: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", PIN_HASH_KEY)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    return verifyHash(pin, data.value);
  }

  // No PIN has been set yet — fall back to the env var (or its default) so
  // existing deployments keep working until an admin changes it.
  const fallback = process.env.ADMIN_PIN || DEFAULT_PIN;
  return pin === fallback;
}

export async function updateAdminPin(newPin: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: PIN_HASH_KEY, value: hashPin(newPin), updated_at: new Date().toISOString() });

  if (error) throw error;
}
