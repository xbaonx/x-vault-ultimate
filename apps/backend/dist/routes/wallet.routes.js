"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const wallet_controller_1 = require("../controllers/wallet.controller");
const router = (0, express_1.Router)();
router.get('/address/:userId', wallet_controller_1.WalletController.getAddress);
router.get('/portfolio/:userId', wallet_controller_1.WalletController.getPortfolio);
router.post('/deploy', wallet_controller_1.WalletController.deployWallet);
exports.default = router;
