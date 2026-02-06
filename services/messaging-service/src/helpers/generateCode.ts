/**
 * Generates a 6-digit numeric join code for workspaces (e.g. 100000–999999).
 * Digits only, no leading zero for readability (first digit 1–9, rest 0–9).
 */
const generateCode = (): string => {
  const first = Math.floor(Math.random() * 9) + 1; // 1–9
  const rest = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10)).join('');
  return `${first}${rest}`;
};

export default generateCode;