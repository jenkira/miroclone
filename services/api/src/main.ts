import { buildApp } from "./app.js";

const tenantId = process.env.ENTRA_TENANT_ID;
if (!tenantId) throw new Error("ENTRA_TENANT_ID is required");
await buildApp({ tenantId }).listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
