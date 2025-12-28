"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const device_routes_1 = __importDefault(require("./device.routes"));
const paymaster_routes_1 = __importDefault(require("./paymaster.routes"));
const wallet_routes_1 = __importDefault(require("./wallet.routes"));
const admin_routes_1 = __importDefault(require("./admin.routes"));
const router = (0, express_1.Router)();
router.use('/device', device_routes_1.default);
router.use('/paymaster', paymaster_routes_1.default);
router.use('/wallet', wallet_routes_1.default);
router.use('/admin', admin_routes_1.default);
exports.default = router;
