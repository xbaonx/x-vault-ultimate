import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class Transaction {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ unique: true })
    userOpHash!: string;

    @Column({ nullable: true })
    txHash!: string;

    @Column({ nullable: true })
    explorerUrl!: string;

    @Column()
    network!: string; // base, polygon, etc.

    @Column()
    status!: string; // pending, success, failed

    @Column({ nullable: true })
    value!: string; // Amount in wei or token units

    @Column({ nullable: true })
    asset!: string; // ETH, USDC, etc.

    @ManyToOne(() => User)
    @JoinColumn({ name: "userId" })
    user!: User;

    @Column()
    userId!: string;

    @Column({ type: 'timestamp', nullable: true })
    executeAt!: Date;

    @Column({ type: 'jsonb', nullable: true })
    txData!: any;

    @CreateDateColumn()
    createdAt!: Date;
}
