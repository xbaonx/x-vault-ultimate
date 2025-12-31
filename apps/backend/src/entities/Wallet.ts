import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";
import { User } from "./User";

@Entity()
export class Wallet {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @ManyToOne(() => User, (user) => user.wallets)
    user!: User;

    @Column()
    @Index()
    address!: string;

    @Column({ default: "Main Wallet" })
    name!: string;

    // Custodial Private Key (Encrypted in real prod, plain for MVP)
    // This allows the backend to execute transactions on any chain after Passkey auth
    @Column({ select: false, nullable: true }) 
    privateKey!: string;

    // Salt used to generate this specific address (Address = hash(User_ID + Salt))
    @Column()
    salt!: string;

    @Column({ default: true })
    isActive!: boolean;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
