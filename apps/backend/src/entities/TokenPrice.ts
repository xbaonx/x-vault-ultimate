import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from "typeorm";

@Entity()
@Index(["chainId", "address", "currency"], { unique: true })
export class TokenPrice {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "int" })
  chainId!: number;

  @Column()
  address!: string;

  @Column({ default: "USD" })
  currency!: string;

  @Column({ type: "float", default: 0 })
  price!: number;

  @Column({ default: "alchemy" })
  source!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
