import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

@Entity()
@Index(["deviceLibraryIdentifier", "passTypeIdentifier", "serialNumber"], { unique: true })
export class PassRegistration {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column()
    deviceLibraryIdentifier!: string;

    @Column()
    passTypeIdentifier!: string;

    @Column()
    serialNumber!: string;

    @Column()
    pushToken!: string;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
