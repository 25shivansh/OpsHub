import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .trim()
    .email("Invalid email format")
    .max(255, "Email must not exceed 255 characters"),
  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Password is required")
    .max(100, "Password must not exceed 100 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;
