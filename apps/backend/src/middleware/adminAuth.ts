import { Request, Response, NextFunction } from "express";
import { config } from "../config";

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const receivedKey = (req.headers["x-admin-key"] as string || "").trim();
  const expectedKey = (config.security.adminKey || "").trim();

  if (!receivedKey || receivedKey !== expectedKey) {
    console.log('[AdminAuth] Unauthorized access attempt');
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
