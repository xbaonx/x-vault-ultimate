"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const paymaster_controller_1 = require("../controllers/paymaster.controller");
const gatekeeper_1 = require("../middleware/gatekeeper");
const router = (0, express_1.Router)();
// Protected: Only registered devices can request sponsorship
router.post('/pm_sponsorUserOperation', gatekeeper_1.gatekeeper, paymaster_controller_1.PaymasterController.sponsorUserOperation);
exports.default = router;
