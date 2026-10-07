import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS is irrelevant to the native mobile client, but this API is also
// reachable from browsers. The default stays permissive (as before); set
// ALLOWED_ORIGINS (comma-separated) on the server to lock this down.
const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));

// Explicit body limits (the 100kb default is kept) — oversized bodies are
// rejected with 413 before reaching route handlers.
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/api", router);

// Version endpoint for auto-update verification (reads deployed version.txt).
app.get("/api/version", (_req: Request, res: Response) => {
  try {
    const fs = require("fs");
    const path = require("path");
    const verFile = path.join(process.cwd(), "version.txt");
    const version = fs.existsSync(verFile)
      ? fs.readFileSync(verFile, "utf8").trim()
      : "unknown";
    res.json({ ok: true, version });
  } catch {
    res.json({ ok: true, version: "unknown" });
  }
});

// Unknown routes → JSON 404 (instead of Express's default HTML page).
app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// Centralized error handler — must be registered last. Express 5 forwards
// rejected promises from async route handlers here. Client responses stay
// generic; the full error (with stack) goes to the server log only.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled request error");
  const rawStatus =
    typeof err === "object" && err !== null
      ? (err as { status?: unknown }).status
      : undefined;
  const status =
    typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600
      ? rawStatus
      : 500;
  const message =
    status === 413
      ? "Payload too large"
      : status < 500
        ? "Bad request"
        : "Internal server error";
  res.status(status).json({ ok: false, error: message });
});

export default app;
