export function getEmailDomain(email: string): string | null {
  if (!email || typeof email !== "string") return null;
  const parts = email.split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}
