import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class PollingSession {
  @PrimaryColumn()
  id!: string;

  @Column({ default: 'pending' })
  status!: string; // 'pending' | 'completed'

  @Column({ nullable: true })
  deviceId!: string;

  @Column({ nullable: true })
  passUrl!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
