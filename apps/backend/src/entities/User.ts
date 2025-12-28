import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class User {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ unique: true })
    walletAddress!: string;

    @Column({ nullable: true })
    deviceLibraryId!: string;

    @Column({ unique: true, nullable: true })
    email!: string;

    @Column({ unique: true, nullable: true })
    appleUserId!: string;

    @Column({ default: false })
    isBiometricEnabled!: boolean;

    // WebAuthn Credentials
    @Column({ nullable: true })
    currentChallenge!: string; // Temporary storage for registration challenge

    @Column({ nullable: true })
    credentialID!: string;

    @Column({ type: 'bytea', nullable: true })
    credentialPublicKey!: Buffer;

    @Column({ default: 0 })
    counter!: number;

    @Column("simple-array", { nullable: true })
    transports!: string[];

    @Column({ default: false })
    isFrozen!: boolean;

    @Column({ type: 'float', default: 2000.0 })
    dailyLimitUsd!: number;

    @Column({ type: 'float', default: 500.0 })
    largeTransactionThresholdUsd!: number;

    @Column({ nullable: true, select: false }) // Do not return by default
    spendingPinHash!: string;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
