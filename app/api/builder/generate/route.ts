import { createGenerateHandler } from "@/lib/scenario-generation";
import { env } from "cloudflare:workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createGenerateHandler({
  runtimeEnv: env,
  logError: (diagnostic) => console.error("conversation_builder_generation_failed", JSON.stringify(diagnostic)),
});
