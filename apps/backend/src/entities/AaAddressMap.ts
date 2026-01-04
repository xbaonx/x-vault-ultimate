import { Entity, PrimaryColumn, Column, UpdateDateColumn, Index } from "typeorm";

@Entity()
@Index(["chainId", "aaAddress"], { unique: true })
export class AaAddressMap {
  @PrimaryColumn()
  id!: string;

  @Column()
  chainId!: number;

  @Column()
  aaAddress!: string;

  @Column()
  serialNumber!: string;

  @Column({ type: 'text', nullable: true })
  deviceId!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
