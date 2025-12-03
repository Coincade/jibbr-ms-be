import { z } from "zod";

export const registerSchema = z.object({
    name: z.string({message: "Name is required"}).min(3, {message: "Name must be at least 3 characters long"}),
    email: z.string({message: "Email is required"}).email({message: "Invalid email address"}),
    password: z.string({message: "Password is required"}).min(8, {message: "Password must be at least 8 characters long"}),
    confirmPassword: z.string({message: "Confirm password is required"}).min(8, {message: "Confirm password must be at least 8 characters long"}),
}).refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match"
});

export const loginSchema = z.object({
    email: z.string({message: "Email is required"}).email({message: "Invalid email address"}),
    password: z.string({message: "Password is required"}).min(8, {message: "Password must be at least 8 characters long"}),
});

export const forgetPasswordSchema = z.object({
    email: z.string({message: "Email is required"}).email({message: "Invalid email address"}),
});

export const forgetResetPasswordSchema = z.object({
    email: z.string({message: "Email is required"}).email({message: "Invalid email address"}),
    token: z.string({message: "Token is required"}),
    password: z.string({message: "Password is required"}).min(8, {message: "Password must be at least 8 characters long"}),
    confirmPassword: z.string({message: "Confirm password is required"}).min(8, {message: "Confirm password must be at least 8 characters long"}),
}).refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match"
});

export const resetPasswordSchema = z.object({
    email: z.string({message: "Email is required"}).email({message: "Invalid email address"}),
    currentPassword: z.string({message: "Current password is required"}).min(8, {message: "Current password must be at least 8 characters long"}),
    password: z.string({message: "New password is required"}).min(8, {message: "New password must be at least 8 characters long"}),
    confirmPassword: z.string({message: "Confirm password is required"}).min(8, {message: "Confirm password must be at least 8 characters long"}),
}).refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match"
});
