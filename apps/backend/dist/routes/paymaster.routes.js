"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const paymaster_controller_1 = require("../controllers/paymaster.controller");
const router = (0, express_1.Router)();
// This endpoint is called by the client (or bundler) to get paymasterAndData
router.post('/pm_sponsorUserOperation', paymaster_controller_1.PaymasterController.sponsorUserOperation);
exports.default = router;
