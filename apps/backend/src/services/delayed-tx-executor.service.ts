import { ethers } from 'ethers';
import { LessThanOrEqual } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Transaction } from '../entities/Transaction';
import { Wallet } from '../entities/Wallet';
import { User } from '../entities/User';
import { ProviderService } from './provider.service';
import { config } from '../config';

export class DelayedTxExecutorService {
  static async runOnce(): Promise<void> {
    if (!AppDataSource.isInitialized) return;

    const txRepo = AppDataSource.getRepository(Transaction);

    const due = await txRepo.find({
      where: {
        status: 'delayed',
        executeAt: LessThanOrEqual(new Date())
      },
      relations: ['user']
    });

    if (!due.length) return;

    for (const tx of due) {
      try {
        const user = tx.user;
        if (!user) continue;

        if (user.isFrozen) {
          continue;
        }

        const walletRepo = AppDataSource.getRepository(Wallet);
        const wallet = await walletRepo
          .createQueryBuilder('wallet')
          .where('wallet.userId = :userId', { userId: user.id })
          .andWhere('wallet.isActive = :isActive', { isActive: true })
          .addSelect('wallet.privateKey')
          .getOne();

        if (!wallet?.privateKey) {
          continue;
        }

        const txData = tx.txData || {};
        const chainId = Number(txData.chainId || config.blockchain.chainId);
        const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === chainId) || config.blockchain.chains.base;

        const provider = ProviderService.getProvider(chainConfig.chainId);
        const signer = new ethers.Wallet(wallet.privateKey, provider);

        const txRequest = {
          to: txData.to,
          value: txData.value ? BigInt(txData.value) : 0n,
          data: txData.data || '0x',
          chainId: chainConfig.chainId
        };

        const resp = await signer.sendTransaction(txRequest);

        tx.status = 'submitted';
        tx.userOpHash = resp.hash;
        await txRepo.save(tx);
      } catch (e) {
        try {
          tx.status = 'failed';
          await txRepo.save(tx);
        } catch { }
      }
    }
  }
}
