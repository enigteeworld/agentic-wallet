import { z } from "zod";

const EnvSchema = z.object({
  RPC_URL: z.string().url().optional(),
  KEYSTORE_PASSPHRASE: z.string().min(8, "KEYSTORE_PASSPHRASE must be at least 8 characters").optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
