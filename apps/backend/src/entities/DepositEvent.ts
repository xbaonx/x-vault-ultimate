import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from "typeorm";

@Entity()
@Index(["chainId", "txHash", "logIndex"], { unique: true })
export class DepositEvent {
  @PrimaryColumn()
  id!: string;

  @Column()
  chainId!: number;

  @Column()
  txHash!: string;

  @Column()
  logIndex!: number;

  @Column()
  walletAddress!: string;

  @Column()
  tokenAddress!: string;

  @Column({ type: "numeric", nullable: true })
  amount!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
