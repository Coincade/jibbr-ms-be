import { z } from "zod";

export const createWorkspaceSchema = z.object({
    name: z.string({message: "Name is required"}).min(3, {message: "Name must be at least 3 characters long"}),
});

export const joinWorkspaceSchema = z.object({
    joinCode: z.string({message: "Join code is required"}).min(6, {message: "Join code must be at least 6 characters long"}),
});


