
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { PassService } from '../services/pass.service';
import { config } from '../config';

export class AppleHealthController {
    static async check(req: Request, res: Response) {
        const checks: any = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            config: {
                teamId: config.apple.teamId ? 'Present' : 'Missing',
                passType: config.apple.passTypeIdentifier ? 'Present' : 'Missing',
                origin: config.security.origin,
                isHttps: config.security.origin?.startsWith('https')
            },
            assets: {},
            certificates: {}
        };

        // 1. Check Model Assets
        const modelPath = path.resolve(__dirname, '../../assets/pass.model');
        checks.assets.directory = fs.existsSync(modelPath) ? 'Found' : 'Missing';
        if (fs.existsSync(modelPath)) {
            const files = fs.readdirSync(modelPath);
            checks.assets.files = files;
            checks.assets.hasJson = files.includes('pass.json');
            checks.assets.hasLogo = files.includes('logo.png');
            checks.assets.hasIcon = files.includes('icon.png');
            checks.assets.hasStrip = files.includes('strip.png');
        }

        // 2. Check Certificates
        // We can't easily check if they are valid without trying to use them, but we can check presence
        // Note: PassService now mocks them if missing, so this might always "work" in terms of generation
        // but we want to know if REAL certs are loaded.
        
        // This is a rough check of what PassService sees
        checks.certificates.env_wwdr = !!config.apple.certificates.wwdr;
        checks.certificates.env_signerCert = !!config.apple.certificates.signerCert;
        checks.certificates.env_signerKey = !!config.apple.certificates.signerKey;

        // 3. Try Dry Run
        try {
            const buffer = await PassService.generatePass({
                address: '0xHealthCheckAddress',
                balance: '100.00',
                ownerName: 'Health Check',
                deviceId: 'health-check-device',
                assets: { 'ETH': { amount: 1, value: 3000 } }
            });
            checks.generation = {
                success: true,
                size: buffer.length
            };
        } catch (e: any) {
            checks.status = 'error';
            checks.generation = {
                success: false,
                error: e.message,
                stack: e.stack
            };
        }

        const statusCode = checks.status === 'ok' ? 200 : 500;
        res.status(statusCode).json(checks);
    }
}
