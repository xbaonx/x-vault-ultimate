import { Entity, PrimaryColumn, Column, UpdateDateColumn, Index } from "typeorm";

@Entity()
@Index(["chainId", "walletAddress", "tokenAddress"], { unique: true })
export class ChainCursor {
  @PrimaryColumn()
  id!: string;

  @Column()
  chainId!: number;

  @Column()
  walletAddress!: string;

  @Column()
  tokenAddress!: string;

  @Column({ type: "bigint", default: 0 })
  lastScannedBlock!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
