"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymasterController = void 0;
const ethers_1 = require("ethers");
const typeorm_1 = require("typeorm");
const config_1 = require("../config");
const data_source_1 = require("../data-source");
const User_1 = require("../entities/User");
const Transaction_1 = require("../entities/Transaction");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
class PaymasterController {
    // Helper to decode UserOp callData
    // Assumes SimpleAccount.execute(address dest, uint256 value, bytes func)
    static decodeCallData(callData) {
        try {
            const iface = new ethers_1.ethers.Interface([
                'function execute(address dest, uint256 value, bytes func)'
            ]);
            const decoded = iface.parseTransaction({ data: callData });
            if (decoded) {
                return {
                    value: decoded.args[1],
                    target: decoded.args[0]
                };
            }
        }
        catch (e) {
            // Fallback or different account implementation
        }
        return { value: 0n, target: '' };
    }
    static async sponsorUserOperation(req, res) {
        try {
            const { userOp, userOpHash, spendingPin } = req.body;
            if (!userOp || !userOpHash) {
                res.status(400).json({ error: 'Missing userOp or userOpHash' });
                return;
            }
            const sender = userOp.sender;
            // 1. Get User
            const userRepo = data_source_1.AppDataSource.getRepository(User_1.User);
            // In a real app, 'walletAddress' should match 'sender'.
            // Note: case-insensitivity might be needed for addresses.
            let user = await userRepo.findOne({
                where: { walletAddress: sender },
                select: ['id', 'walletAddress', 'isFrozen', 'dailyLimitUsd', 'largeTransactionThresholdUsd', 'spendingPinHash'] // Need to explicitly select hidden columns
            });
            // If user not found by exact address, try case-insensitive search or mock association logic
            // For MVP, we assume exact match or strict requirement
            if (!user) {
                // ... (same as before)
            }
            if (user) {
                // 2. Check Spending Limits
                if (user.isFrozen) {
                    res.status(403).json({ error: 'Account is frozen' });
                    return;
                }
                const { value } = PaymasterController.decodeCallData(userOp.callData);
                if (value > 0n) {
                    // Convert to USD (Mock rate: 1 ETH = $2500)
                    const ethValue = parseFloat(ethers_1.ethers.formatEther(value));
                    const usdValue = ethValue * 2500;
                    // --- Spending PIN Check for Large Transactions ---
                    if (usdValue >= user.largeTransactionThresholdUsd) {
                        if (!user.spendingPinHash) {
                            res.status(400).json({ error: 'Spending PIN required for this amount but not set on account.' });
                            return;
                        }
                        if (!spendingPin) {
                            res.status(401).json({ error: 'Spending PIN required for large transactions.' });
                            return;
                        }
                        const validPin = await bcryptjs_1.default.compare(spendingPin, user.spendingPinHash);
                        if (!validPin) {
                            res.status(401).json({ error: 'Invalid Spending PIN.' });
                            return;
                        }
                        console.log(`[Paymaster] Large transaction ($${usdValue}) authorized with PIN.`);
                    }
                    // Get last 24h transactions
                    const txRepo = data_source_1.AppDataSource.getRepository(Transaction_1.Transaction);
                    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const recentTxs = await txRepo.find({
                        where: {
                            user: { id: user.id },
                            createdAt: (0, typeorm_1.MoreThan)(oneDayAgo)
                        }
                    });
                    // Calculate total spent
                    // Note: transaction.value is string (wei)
                    let totalSpentUsd = 0;
                    for (const tx of recentTxs) {
                        if (tx.value) {
                            const txEth = parseFloat(ethers_1.ethers.formatEther(tx.value));
                            totalSpentUsd += txEth * 2500;
                        }
                    }
                    if (totalSpentUsd + usdValue > user.dailyLimitUsd) {
                        console.warn(`[Paymaster] Blocked transaction: Limit exceeded. Spent: $${totalSpentUsd}, Attempt: $${usdValue}, Limit: $${user.dailyLimitUsd}`);
                        res.status(403).json({ error: `Daily spending limit exceeded ($${user.dailyLimitUsd})` });
                        return;
                    }
                    // 3. Record "Pending" Transaction
                    // We save it now to reserve the quota. Status 'pending'.
                    const newTx = txRepo.create({
                        userOpHash,
                        network: 'base-sepolia', // or derive from chainId
                        status: 'pending',
                        value: value.toString(),
                        asset: 'ETH',
                        user: user
                    });
                    await txRepo.save(newTx);
                }
            }
            // Sign the operation
            // The Paymaster contract expects a signature over:
            // keccak256(abi.encodePacked(userOpHash, validUntil, validAfter))
            const validUntil = Math.floor(Date.now() / 1000) + 3600; // 1 hour
            const validAfter = Math.floor(Date.now() / 1000);
            // Pack data similar to Solidity: abi.encodePacked(userOpHash, validUntil, validAfter)
            // validUntil and validAfter are uint48 (6 bytes).
            const coder = ethers_1.ethers.AbiCoder.defaultAbiCoder(); // unused but kept for ref
            // We need to pack it tightly.
            // ethers.solidityPacked is perfect for abi.encodePacked
            const message = ethers_1.ethers.solidityPacked(['bytes32', 'uint48', 'uint48'], [userOpHash, validUntil, validAfter]);
            const signer = new ethers_1.ethers.Wallet(config_1.config.blockchain.paymaster.signingKey || ethers_1.ethers.Wallet.createRandom().privateKey);
            // Sign the hash of the message (EthSignedMessage)
            // The contract uses ECDSA.recover which works with eth signed message hash
            const signature = await signer.signMessage(ethers_1.ethers.getBytes(ethers_1.ethers.keccak256(message)));
            // Construct paymasterAndData
            // Contract expects: [paymasterAddress (20)] [validUntil (6)] [validAfter (6)] [signature (dynamic)]
            const paymasterAddress = config_1.config.blockchain.paymaster.address || '0x0000000000000000000000000000000000000000'; // Replace with actual address
            // Encode times as 6 bytes hex
            const validUntilHex = ethers_1.ethers.toBeHex(validUntil, 6);
            const validAfterHex = ethers_1.ethers.toBeHex(validAfter, 6);
            // Concatenate
            const paymasterAndData = ethers_1.ethers.concat([
                paymasterAddress,
                validUntilHex,
                validAfterHex,
                signature
            ]);
            res.status(200).json({
                paymasterAndData: ethers_1.ethers.hexlify(paymasterAndData),
                validUntil,
                validAfter
            });
        }
        catch (error) {
            console.error('Error in sponsorUserOperation:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}
exports.PaymasterController = PaymasterController;
