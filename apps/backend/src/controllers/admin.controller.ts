import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { AppleConfig } from "../entities/AppleConfig";

export class AdminController {
  static async getAppleConfig(req: Request, res: Response) {
    try {
      const repo = AppDataSource.getRepository(AppleConfig);
      const row = await repo.findOne({ where: { name: "default" } });

      if (!row) {
        res.status(200).json({
          configured: false,
          teamId: null,
          passTypeIdentifier: null,
          hasWwdr: false,
          hasSignerCert: false,
          hasSignerKey: false,
          hasSignerKeyPassphrase: false,
        });
        return;
      }

      res.status(200).json({
        configured: !!(row.teamId && row.passTypeIdentifier),
        teamId: row.teamId || null,
        passTypeIdentifier: row.passTypeIdentifier || null,
        hasWwdr: !!row.wwdrPem,
        hasSignerCert: !!row.signerCertPem,
        hasSignerKey: !!row.signerKeyPem,
        hasSignerKeyPassphrase: !!row.signerKeyPassphrase,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      console.error("Error in getAppleConfig:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async upsertAppleConfig(req: Request, res: Response) {
    try {
      const {
        teamId,
        passTypeIdentifier,
        signerKeyPassphrase,
        wwdrPem,
        signerCertPem,
        signerKeyPem,
      } = req.body || {};

      const repo = AppDataSource.getRepository(AppleConfig);
      const existing = await repo.findOne({ where: { name: "default" } });

      const row = existing || repo.create({ name: "default" });

      if (typeof teamId === "string") row.teamId = teamId;
      if (typeof passTypeIdentifier === "string") row.passTypeIdentifier = passTypeIdentifier;
      if (typeof signerKeyPassphrase === "string") row.signerKeyPassphrase = signerKeyPassphrase;
      if (typeof wwdrPem === "string") row.wwdrPem = wwdrPem;
      if (typeof signerCertPem === "string") row.signerCertPem = signerCertPem;
      if (typeof signerKeyPem === "string") row.signerKeyPem = signerKeyPem;

      const saved = await repo.save(row);

      res.status(200).json({
        ok: true,
        id: saved.id,
        updatedAt: saved.updatedAt,
      });
    } catch (error) {
      console.error("Error in upsertAppleConfig:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async uploadAppleCerts(req: Request, res: Response) {
    try {
      const repo = AppDataSource.getRepository(AppleConfig);
      const existing = await repo.findOne({ where: { name: "default" } });
      const row = existing || repo.create({ name: "default" });

      const { teamId, passTypeIdentifier, signerKeyPassphrase } = req.body || {};
      if (typeof teamId === "string") row.teamId = teamId;
      if (typeof passTypeIdentifier === "string") row.passTypeIdentifier = passTypeIdentifier;
      if (typeof signerKeyPassphrase === "string") row.signerKeyPassphrase = signerKeyPassphrase;

      const files = req.files as
        | {
            [fieldname: string]: Express.Multer.File[];
          }
        | undefined;

      const wwdrFile = files?.wwdr?.[0];
      const signerCertFile = files?.signerCert?.[0];
      const signerKeyFile = files?.signerKey?.[0];

      if (wwdrFile) row.wwdrPem = wwdrFile.buffer.toString("utf8");
      if (signerCertFile) row.signerCertPem = signerCertFile.buffer.toString("utf8");
      if (signerKeyFile) row.signerKeyPem = signerKeyFile.buffer.toString("utf8");

      const saved = await repo.save(row);

      res.status(200).json({
        ok: true,
        id: saved.id,
        updatedAt: saved.updatedAt,
        hasWwdr: !!saved.wwdrPem,
        hasSignerCert: !!saved.signerCertPem,
        hasSignerKey: !!saved.signerKeyPem,
      });
    } catch (error) {
      console.error("Error in uploadAppleCerts:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
