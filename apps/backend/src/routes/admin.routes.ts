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
router.get("/apple/test-pass", adminAuth, AdminController.testGeneratePass);

router.post(
  "/apple/certs",
  adminAuth,
  (upload.fields([
    { name: "wwdr", maxCount: 1 },
    { name: "signerP12", maxCount: 1 },
  ]) as any),
  AdminController.uploadAppleCerts
);

router.post("/users/:userId/freeze", adminAuth, AdminController.freezeUser);
router.post("/users/:userId/unfreeze", adminAuth, AdminController.unfreezeUser);
router.post("/users/:userId/limit", adminAuth, AdminController.updateUserLimit);
router.post("/users/:userId/reset-device-lock", adminAuth, AdminController.forceResetDeviceLock);

export default router;
