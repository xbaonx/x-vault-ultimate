import { Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';

export class PaymasterController {
  static async sponsorUserOperation(req: Request, res: Response) {
    try {
      const { userOp, userOpHash } = req.body;

      if (!userOp || !userOpHash) {
        res.status(400).json({ error: 'Missing userOp or userOpHash' });
        return;
      }

      // Check business logic: does user have credit? is device valid?
      // For MVP, we approve all.

      // Sign the operation
      // The Paymaster contract expects a signature over:
      // keccak256(abi.encodePacked(userOpHash, validUntil, validAfter))
      
      const validUntil = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const validAfter = Math.floor(Date.now() / 1000);
      
      // Pack data similar to Solidity: abi.encodePacked(userOpHash, validUntil, validAfter)
      // validUntil and validAfter are uint48 (6 bytes).
      
      const coder = ethers.AbiCoder.defaultAbiCoder();
      
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
