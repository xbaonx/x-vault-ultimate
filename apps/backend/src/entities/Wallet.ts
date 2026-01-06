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

    @Column({ type: 'int', default: 0 })
    aaSalt!: number;

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
