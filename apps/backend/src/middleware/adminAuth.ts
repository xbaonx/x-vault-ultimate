import { Request, Response, NextFunction } from "express";
import { config } from "../config";

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const adminKey = req.headers["x-admin-key"];

  // Debug logging
  console.log(`[AdminAuth] Received key: '${adminKey}', Expected: '${config.security.adminKey}'`);

  if (!adminKey || adminKey !== config.security.adminKey) {
    console.log('[AdminAuth] Unauthorized access attempt');
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
