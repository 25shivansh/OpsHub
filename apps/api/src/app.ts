import express, { Express } from "express";
import cors from "cors";
import { errorHandler } from "./middleware";
import { authRouter } from "./modules/auth/auth.routes";
import { workItemsRouter } from "./modules/work-items/work-items.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { incidentsRouter } from "./modules/incidents/incidents.routes";
import { slaPolicyRouter } from "./modules/sla/sla.routes";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Mount API v1 endpoints
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/items", workItemsRouter);
  app.use("/api/v1/notifications", notificationsRouter);
  app.use("/api/v1/dashboard", dashboardRouter);
  app.use("/api/v1/incidents", incidentsRouter);
  app.use("/api/v1/teams", slaPolicyRouter);

  // Catch-all 404 handler for unmatched routes
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Endpoint not found",
      },
    });
  });

  // Central error handling middleware
  app.use(errorHandler);

  return app;
}
