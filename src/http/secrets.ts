import { createHash, timingSafeEqual } from "node:crypto";

/** Compara secretos en tiempo constante (también si tienen distinta longitud). */
export function sameSecret(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}
