import { Request, Response, NextFunction } from "express";
import { config } from "../config";

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const adminKey = req.headers["x-admin-key"];

  if (!adminKey || adminKey !== config.security.adminKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
