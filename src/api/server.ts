import "dotenv/config";
import express from "express";
import cors from "cors";
import { strategiesRouter } from "./routes/strategies";

const app = express();
const port = Number(process.env.CARV1_API_PORT ?? 8787);

app.use(cors());
app.use(express.json());

// 🔍 request logger (VERY useful for debugging chat → backend)
app.use((req, _res, next) => {
  console.log(`[carv1-api] ${req.method} ${req.url}`);
  next();
});

// base route (optional but useful sanity check)
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "carv1-api",
    routes: ["/health", "/strategies"],
  });
});

// health
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "carv1-api",
    ts: new Date().toISOString(),
  });
});

// strategies
app.use("/strategies", strategiesRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

// start server
app.listen(port, () => {
  console.log(`\n[carv1-api] listening on http://127.0.0.1:${port}`);
  console.log(`[carv1-api] health → http://127.0.0.1:${port}/health`);
  console.log(`[carv1-api] strategies → http://127.0.0.1:${port}/strategies\n`);
});