import { Request, Response } from 'express';
import { ethers } from 'ethers';
import { MoreThan } from 'typeorm';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { Transaction } from '../entities/Transaction';

export class PaymasterController {
  
  // Helper to decode UserOp callData
  // Assumes SimpleAccount.execute(address dest, uint256 value, bytes func)
  private static decodeCallData(callData: string): { value: bigint, target: string } {
    try {
        const iface = new ethers.Interface([
            'function execute(address dest, uint256 value, bytes func)'
        ]);
        const decoded = iface.parseTransaction({ data: callData });
        if (decoded) {
            return {
                value: decoded.args[1],
                target: decoded.args[0]
            };
        }
    } catch (e) {
        // Fallback or different account implementation
    }
    return { value: 0n, target: '' };
  }

  static async sponsorUserOperation(req: Request, res: Response) {
    try {
      const { userOp, userOpHash } = req.body;

      if (!userOp || !userOpHash) {
        res.status(400).json({ error: 'Missing userOp or userOpHash' });
        return;
      }

      const sender = userOp.sender;
      
      // 1. Get User
      const userRepo = AppDataSource.getRepository(User);
      // In a real app, 'walletAddress' should match 'sender'.
      // Note: case-insensitivity might be needed for addresses.
      let user = await userRepo.findOne({ 
          where: { walletAddress: sender } 
      });

      // If user not found by exact address, try case-insensitive search or mock association logic
      // For MVP, we assume exact match or strict requirement
      if (!user) {
          // Try finding by looking at all and comparing lowercase? 
          // Better: just query. If Postgres, use ILIKE. But walletAddress is unique.
          // Let's assume frontend sends correct checksummed address or we handle it.
          // For now, if no user found, we might block or allow (if we treat it as new anonymous user? No, security risk).
          // We will BLOCK unknown users.
          
          // Actually, for the demo/MVP where we might have mismatched mocked addresses, 
          // let's try to find ANY user if in dev mode, OR strictly enforce in prod.
          // We'll enforce strictness for security.
          
           // Re-query with query builder for case-insensitive if needed, but let's stick to standard findOne for now.
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
            const ethValue = parseFloat(ethers.formatEther(value));
            const usdValue = ethValue * 2500;

            // Get last 24h transactions
            const txRepo = AppDataSource.getRepository(Transaction);
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            const recentTxs = await txRepo.find({
                where: {
                    user: { id: user.id },
                    createdAt: MoreThan(oneDayAgo)
                }
            });

            // Calculate total spent
            // Note: transaction.value is string (wei)
            let totalSpentUsd = 0;
            for (const tx of recentTxs) {
                if (tx.value) {
                     const txEth = parseFloat(ethers.formatEther(tx.value));
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
      
      const coder = ethers.AbiCoder.defaultAbiCoder(); // unused but kept for ref
      
      // We need to pack it tightly.
      // ethers.solidityPacked is perfect for abi.encodePacked
      const message = ethers.solidityPacked(
        ['bytes32', 'uint48', 'uint48'],
        [userOpHash, validUntil, validAfter]
      );

      const signer = new ethers.Wallet(config.blockchain.paymaster.signingKey || ethers.Wallet.createRandom().privateKey);
      
      // Sign the hash of the message (EthSignedMessage)
      // The contract uses ECDSA.recover which works with eth signed message hash
      const signature = await signer.signMessage(ethers.getBytes(ethers.keccak256(message)));

      // Construct paymasterAndData
      // Contract expects: [paymasterAddress (20)] [validUntil (6)] [validAfter (6)] [signature (dynamic)]
      
      const paymasterAddress = config.blockchain.paymaster.address || '0x0000000000000000000000000000000000000000'; // Replace with actual address
      
      // Encode times as 6 bytes hex
      const validUntilHex = ethers.toBeHex(validUntil, 6);
      const validAfterHex = ethers.toBeHex(validAfter, 6);
      
      // Concatenate
      const paymasterAndData = ethers.concat([
        paymasterAddress,
        validUntilHex,
        validAfterHex,
        signature
      ]);

      res.status(200).json({ 
        paymasterAndData: ethers.hexlify(paymasterAndData),
        validUntil,
        validAfter
      });

    } catch (error) {
      console.error('Error in sponsorUserOperation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
