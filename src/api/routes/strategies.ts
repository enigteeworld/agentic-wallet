import { Router } from "express";
import {
  getManagedStrategySummary,
  getManagedStrategyDetail,
} from "../lib/serializers";

export const strategiesRouter = Router();

strategiesRouter.get("/", (req, res) => {
  try {
    const agentId =
      typeof req.query.agent === "string" && req.query.agent.trim().length > 0
        ? req.query.agent.trim()
        : "agent-001";

    const strategy = getManagedStrategySummary(agentId);

    res.json({
      ok: true,
      agentId,
      strategies: [strategy],
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: String(error?.message ?? error),
    });
  }
});

strategiesRouter.get("/:id", (req, res) => {
  try {
    const agentId =
      typeof req.query.agent === "string" && req.query.agent.trim().length > 0
        ? req.query.agent.trim()
        : "agent-001";

    const strategyId = String(req.params.id);

    if (strategyId !== "carv-1") {
      res.status(404).json({
        ok: false,
        error: `Strategy not found: ${strategyId}`,
      });
      return;
    }

    const strategy = getManagedStrategyDetail(agentId, strategyId);

    res.json({
      ok: true,
      agentId,
      strategy,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: String(error?.message ?? error),
    });
  }
});