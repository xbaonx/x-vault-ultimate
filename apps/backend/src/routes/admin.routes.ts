import { Router } from "express";
import multer from "multer";
import { adminAuth } from "../middleware/adminAuth";
import { AdminController } from "../controllers/admin.controller";

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

router.get("/dashboard", adminAuth, AdminController.getDashboardStats);
router.get("/users", adminAuth, AdminController.getUsers);
router.get("/transactions", adminAuth, AdminController.getTransactions);

router.get("/apple/config", adminAuth, AdminController.getAppleConfig);
router.post("/apple/config", adminAuth, AdminController.upsertAppleConfig);

router.post(
  "/apple/certs",
  adminAuth,
  (upload.fields([
    { name: "wwdr", maxCount: 1 },
    { name: "signerCert", maxCount: 1 },
    { name: "signerKey", maxCount: 1 },
  ]) as any),
  AdminController.uploadAppleCerts
);

export default router;
