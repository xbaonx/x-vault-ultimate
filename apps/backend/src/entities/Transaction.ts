import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class Transaction {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ unique: true })
    userOpHash!: string;

    @Column()
    network!: string; // base, polygon, etc.

    @Column()
    status!: string; // pending, success, failed

    @ManyToOne(() => User)
    @JoinColumn({ name: "userId" })
    user!: User;

    @Column()
    userId!: string;

    @CreateDateColumn()
    createdAt!: Date;
}
