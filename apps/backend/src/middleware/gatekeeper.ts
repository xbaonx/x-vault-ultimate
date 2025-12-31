import { Request, Response, NextFunction } from "express";
import { AppDataSource } from "../data-source";
import { Device } from "../entities/Device";
import { User } from "../entities/User";

export async function gatekeeper(req: Request, res: Response, next: NextFunction) {
  const deviceId = req.headers["x-device-library-id"] as string;

  if (!deviceId) {
    console.warn("[Gatekeeper] Blocked request: Missing Device ID");
    res.status(403).json({ error: "Access Denied: Device ID required" });
    return;
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
