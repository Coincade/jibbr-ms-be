import { z } from "zod";

export const createWorkspaceSchema = z.object({
    name: z.string({message: "Name is required"}).min(3, {message: "Name must be at least 3 characters long"}),
});

const joinCodeSixDigits = z
  .string({ message: "Join code is required" })
  .length(6, { message: "Join code must be exactly 6 digits" })
  .regex(/^\d{6}$/, { message: "Join code must be exactly 6 digits" });

export const joinWorkspaceSchema = z.object({
  joinCode: joinCodeSixDigits,
});

/** Accept either new 6-digit code or previous alphanumeric join code for backward compatibility */
const joinCodeForJoinByCode = z.union([
  joinCodeSixDigits,
  z.string({ message: "Join code is required" }).min(1).max(32),
]);

export const joinWorkspaceByCodeSchema = z.object({
  joinCode: joinCodeForJoinByCode,
});


