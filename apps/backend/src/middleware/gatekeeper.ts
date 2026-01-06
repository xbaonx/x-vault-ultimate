import { Request, Response, NextFunction } from "express";
import { AppDataSource } from "../data-source";
import { Device } from "../entities/Device";
import { User } from "../entities/User";
import { config } from "../config";
import { verifyDeviceJwt } from "../utils/jwt";

export async function gatekeeper(req: Request, res: Response, next: NextFunction) {
  const deviceId = req.headers["x-device-library-id"] as string;
  const authHeader = String(req.headers.authorization || '').trim();

  if (!deviceId) {
    console.warn("[Gatekeeper] Blocked request: Missing Device ID");
    res.status(403).json({ error: "Access Denied: Device ID required" });
    return;
  }

  if (config.nodeEnv === 'production') {
    const jwtSecret = String(config.security.jwtSecret || '').trim();
    if (!jwtSecret) {
      res.status(500).json({ error: 'Server misconfigured: JWT_SECRET missing' });
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = authHeader.replace('Bearer ', '').trim();
    try {
      const payload = verifyDeviceJwt(token);
      if (payload.deviceId !== deviceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  try {
    const deviceRepo = AppDataSource.getRepository(Device);
    // Find device and load associated user
    const device = await deviceRepo.findOne({ 
        where: { deviceLibraryId: deviceId },
        relations: ["user"] 
    });

    if (!device || !device.user) {
      console.warn(`[Gatekeeper] Blocked request: Unknown Device ID ${deviceId}`);
      res.status(403).json({ error: "Access Denied: Device not recognized" });
      return;
    }

    if (config.nodeEnv === 'production' && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '').trim();
        const payload = verifyDeviceJwt(token);
        if (String(payload.sub) !== String(device.user.id)) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      } catch {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    const user = device.user;

    if (user.isFrozen || !device.isActive) {
      console.warn(`[Gatekeeper] Blocked request: User ${user.id} Frozen or Device Inactive`);
      res.status(403).json({ error: "Access Denied: Account Frozen or Device Inactive" });
      return;
    }

    // Attach user to request for downstream controllers
    (req as any).user = user;
    (req as any).device = device;
    
    // In production, we would also verify the 'x-signature' header here
    // where the device signs the request body/timestamp with the Secure Enclave key.
    
    next();
  } catch (error) {
    console.error("[Gatekeeper] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
