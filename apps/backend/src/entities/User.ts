import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from "typeorm";
import { Device } from "./Device";
import { Wallet } from "./Wallet";

@Entity()
export class User {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ unique: true, nullable: true })
    email!: string;

    @Column({ unique: true, nullable: true })
    appleUserId!: string;

    // Relations
    @OneToMany(() => Device, (device) => device.user)
    devices!: Device[];

    @OneToMany(() => Wallet, (wallet) => wallet.user)
    wallets!: Wallet[];

    // Configuration
    @Column({ default: false })
    isFrozen!: boolean;

    @Column({ type: 'float', default: 2000.0 })
    dailyLimitUsd!: number;

    @Column({ type: 'float', default: 500.0 })
    largeTransactionThresholdUsd!: number;

    @Column({ nullable: true, select: false })
    spendingPinHash!: string;

    // Legacy fields - kept temporarily if needed for migration, 
    // but in a clean break we remove them. 
    // For this refactor, I will remove them to enforce usage of new tables.
    
    // Quick access to main wallet address (optional, can be derived from wallets[0])
    @Column({ nullable: true })
    defaultWalletAddress!: string;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
