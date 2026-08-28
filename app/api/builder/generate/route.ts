import { createGenerateHandler } from "@/lib/scenario-generation";
import { env } from "cloudflare:workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createGenerateHandler({ runtimeEnv: env });
