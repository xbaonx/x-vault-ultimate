import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class Device {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ unique: true })
    deviceLibraryId!: string;

    @Column({ nullable: true })
    pushToken!: string;

    @ManyToOne(() => User)
    @JoinColumn({ name: "userId" })
    user!: User;

    @Column()
    userId!: string;

    @CreateDateColumn()
    createdAt!: Date;
}
