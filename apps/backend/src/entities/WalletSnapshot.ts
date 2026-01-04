import { Entity, PrimaryColumn, Column, UpdateDateColumn, Index } from "typeorm";

@Entity()
@Index(["serialNumber"], { unique: true })
export class WalletSnapshot {
  @PrimaryColumn()
  serialNumber!: string;

  @Column({ type: "float", default: 0 })
  totalBalanceUsd!: number;

  @Column({ type: "jsonb", nullable: true })
  assets!: Record<string, { amount: number; value: number }> | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
