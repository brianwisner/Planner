import bcrypt from "bcryptjs";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}
export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
export function validatePasswordStrength(p: string): string | null {
  if (p.length < 10) return "Password must be at least 10 characters.";
  return null;
}
