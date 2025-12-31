import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { User } from "./User";

@Entity()
export class Device {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ unique: true })
    @Index()
    deviceLibraryId!: string;

    @Column({ nullable: true })
    name!: string; // e.g. "Bao's iPhone"

    @Column({ nullable: true })
    pushToken!: string;

    @ManyToOne(() => User, (user) => user.devices)
    @JoinColumn({ name: "userId" })
    user!: User;

    @Column()
    userId!: string;

    // WebAuthn Credentials specific to this device
    @Column({ nullable: true })
    credentialID!: string;

    @Column({ type: 'bytea', nullable: true })
    credentialPublicKey!: Buffer;

    @Column({ default: 0 })
    counter!: number;

    @Column("simple-array", { nullable: true })
    transports!: string[];

    @Column({ nullable: true })
    currentChallenge!: string;

    @Column({ default: true })
    isActive!: boolean;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    lastActiveAt!: Date;
}
