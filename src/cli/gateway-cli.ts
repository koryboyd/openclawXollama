// src/cli/gateway-cli.ts
export { registerGatewayCli } from "./gateway-cli/register.js";

// ------------------------------------------------------------------
//  Enable the optional audit logger *before* any other code runs.
// ------------------------------------------------------------------
import { enableAuditIfRequested } from "../utils/audit.js";
enableAuditIfRequested();
