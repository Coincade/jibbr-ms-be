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

export const joinWorkspaceByCodeSchema = z.object({
  joinCode: joinCodeSixDigits,
});


