import "dotenv/config";
import express from "express";
import cors from "cors";
import { strategiesRouter } from "./routes/strategies";

const app = express();
const port = Number(process.env.CARV1_API_PORT ?? 8787);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "carv1-api",
    ts: new Date().toISOString(),
  });
});

app.use("/strategies", strategiesRouter);

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

app.listen(port, () => {
  console.log(`[carv1-api] listening on http://127.0.0.1:${port}`);
});