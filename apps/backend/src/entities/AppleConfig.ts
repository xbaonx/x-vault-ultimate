import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class AppleConfig {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ default: "default", unique: true })
  name!: string;

  @Column({ nullable: true })
  teamId!: string;

  @Column({ nullable: true })
  passTypeIdentifier!: string;

  @Column({ type: "text", nullable: true })
  wwdrPem!: string;

  @Column({ type: "text", nullable: true })
  signerCertPem!: string;

  @Column({ type: "text", nullable: true })
  signerKeyPem!: string;

  @Column({ type: "text", nullable: true })
  signerKeyPassphrase!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
