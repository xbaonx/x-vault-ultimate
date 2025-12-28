import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class User {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ unique: true })
    walletAddress!: string;

    @Column({ nullable: true })
    deviceLibraryId!: string;

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

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
