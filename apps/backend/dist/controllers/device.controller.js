"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceController = void 0;
const uuid_1 = require("uuid");
const pass_service_1 = require("../services/pass.service");
const data_source_1 = require("../data-source");
const PollingSession_1 = require("../entities/PollingSession");
const User_1 = require("../entities/User");
const server_1 = require("@simplewebauthn/server");
const config_1 = require("../config");
class DeviceController {
    // Helper to determine RP_ID and Origin dynamically if not set in env
    static getSecurityConfig(req) {
        const requestOrigin = req.get('Origin') || '';
        let { rpId, origin } = config_1.config.security;
        // If we are in production or receiving a request from a real domain,
        // and the config is still default 'localhost', try to adapt.
        if (rpId === 'localhost' && requestOrigin && !requestOrigin.includes('localhost')) {
            try {
                const url = new URL(requestOrigin);
                rpId = url.hostname;
                origin = requestOrigin;
                console.log(`[Device] Adapted RP_ID to ${rpId} and Origin to ${origin} from request.`);
            }
            catch (e) {
                console.warn('[Device] Failed to parse request origin for dynamic RP_ID fallback');
            }
        }
        return { rpId, origin };
    }
    /**
     * Step 1: Generate WebAuthn Registration Options
     */
    static async generateRegistrationOptions(req, res) {
        try {
            const { rpId } = DeviceController.getSecurityConfig(req);
            const { userId } = req.body; // Optional: Link to existing user (SIWA)
            const userRepo = data_source_1.AppDataSource.getRepository(User_1.User);
            let user = null;
            if (userId) {
                user = await userRepo.findOneBy({ id: userId });
            }
            if (!user) {
                // Create a provisional user if no ID provided or not found
                // In a real flow, you might ask for a username or just generate one for a new wallet
                user = userRepo.create({
                    walletAddress: 'pending-' + (0, uuid_1.v4)(), // Placeholder until address is calculated or we use this UUID
                });
            }
            const username = user.email || `user-${user.id || (0, uuid_1.v4)().slice(0, 8)}`;
            // Generate options
            const options = await (0, server_1.generateRegistrationOptions)({
                rpName: config_1.config.security.rpName,
                rpID: rpId,
                userID: new Uint8Array(Buffer.from(user.id || (0, uuid_1.v4)())), // Convert string to Uint8Array. Note: if user is new, id might be undefined before save, but TypeORM usually needs save first for UUID.
                userName: username,
                // Don't exclude credentials for now as we are creating a new one
                attestationType: 'none',
                authenticatorSelection: {
                    residentKey: 'preferred',
                    userVerification: 'required', // Critical for Biometric Gate
                    authenticatorAttachment: 'platform', // Force Platform authenticator (FaceID/TouchID)
                },
            });
            // Save challenge to user
            // We need to persist this user to retrieve challenge later.
            user.currentChallenge = options.challenge;
            // If user was just created (no ID), save will generate ID. 
            // If user existed, save updates it.
            await userRepo.save(user);
            // Return the ID we just created so frontend can send it back
            res.status(200).json({ options, tempUserId: user.id });
        }
        catch (error) {
            console.error('Error generating registration options:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    /**
     * Step 2: Verify WebAuthn Registration Response
     */
    static async verifyRegistration(req, res) {
        try {
            const { tempUserId, response } = req.body;
            const { rpId, origin } = DeviceController.getSecurityConfig(req);
            const userRepo = data_source_1.AppDataSource.getRepository(User_1.User);
            const user = await userRepo.findOneBy({ id: tempUserId });
            if (!user || !user.currentChallenge) {
                res.status(400).json({ error: 'User or challenge not found' });
                return;
            }
            const verification = await (0, server_1.verifyRegistrationResponse)({
                response,
                expectedChallenge: user.currentChallenge,
                expectedOrigin: origin,
                expectedRPID: rpId,
            });
            if (verification.verified && verification.registrationInfo) {
                const { credential } = verification.registrationInfo;
                const credentialID = credential.id;
                const credentialPublicKey = credential.publicKey;
                const counter = credential.counter;
                // 1. Update User with Credential Info
                user.credentialID = Buffer.from(credentialID).toString('base64');
                user.credentialPublicKey = Buffer.from(credentialPublicKey);
                user.counter = counter;
                user.isBiometricEnabled = true;
                user.currentChallenge = ''; // Clear challenge
                // 2. Calculate Deterministic Wallet Address (mock logic from before, but finalized)
                // Only generate if not already set (or if pending)
                let deviceLibraryId = user.deviceLibraryId;
                if (!deviceLibraryId) {
                    deviceLibraryId = (0, uuid_1.v4)();
                    user.deviceLibraryId = deviceLibraryId;
                }
                if (!user.walletAddress || user.walletAddress.startsWith('pending-')) {
                    const mockWalletAddress = `0x${deviceLibraryId.replace(/-/g, '').substring(0, 40)}`;
                    user.walletAddress = mockWalletAddress;
                }
                await userRepo.save(user);
                // 3. Create Session for Pass Generation (Legacy support for Onboarding flow)
                const sessionRepo = data_source_1.AppDataSource.getRepository(PollingSession_1.PollingSession);
                const sessionId = (0, uuid_1.v4)();
                const newSession = sessionRepo.create({
                    id: sessionId,
                    status: 'completed',
                    deviceId: deviceLibraryId,
                    passUrl: `/api/device/pass/${deviceLibraryId}`
                });
                await sessionRepo.save(newSession);
                console.log(`[Device] WebAuthn Registration success. User: ${user.id}, Address: ${user.walletAddress}`);
                res.status(200).json({
                    verified: true,
                    sessionId,
                    deviceLibraryId,
                    walletAddress: user.walletAddress
                });
            }
            else {
                res.status(400).json({ verified: false, error: 'Verification failed' });
            }
        }
        catch (error) {
            console.error('Error verifying registration:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    static async register(req, res) {
        // Legacy mock register - kept for fallback or testing if WebAuthn fails in dev
        // ... logic same as before ...
        try {
            const sessionRepo = data_source_1.AppDataSource.getRepository(PollingSession_1.PollingSession);
            const userRepo = data_source_1.AppDataSource.getRepository(User_1.User);
            // Start a new polling session
            const sessionId = (0, uuid_1.v4)();
            const newSession = sessionRepo.create({
                id: sessionId,
                status: 'pending'
            });
            await sessionRepo.save(newSession);
            console.log(`[Device] Created session (LEGACY): ${sessionId}.`);
            const deviceLibraryId = (0, uuid_1.v4)();
            setTimeout(async () => {
                try {
                    const session = await sessionRepo.findOneBy({ id: sessionId });
                    if (session) {
                        session.status = 'completed';
                        session.deviceId = deviceLibraryId;
                        session.passUrl = `/api/device/pass/${deviceLibraryId}`;
                        await sessionRepo.save(session);
                        const mockWalletAddress = `0x${deviceLibraryId.replace(/-/g, '').substring(0, 40)}`;
                        let user = await userRepo.findOneBy({ walletAddress: mockWalletAddress });
                        if (!user) {
                            user = userRepo.create({
                                walletAddress: mockWalletAddress,
                                deviceLibraryId: deviceLibraryId,
                                isBiometricEnabled: true
                            });
                            await userRepo.save(user);
                        }
                    }
                }
                catch (err) {
                    console.error(`[Device] Error updating session ${sessionId}:`, err);
                }
            }, 2000);
            res.status(200).json({ sessionId });
        }
        catch (error) {
            console.error('Error in register:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    static async pollStatus(req, res) {
        try {
            const { sessionId } = req.params;
            const sessionRepo = data_source_1.AppDataSource.getRepository(PollingSession_1.PollingSession);
            const session = await sessionRepo.findOneBy({ id: sessionId });
            console.log(`[Device] Polling session: ${sessionId}. Found: ${!!session}`);
            if (!session) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            res.status(200).json(session);
        }
        catch (error) {
            console.error('Error in pollStatus:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    static async downloadPass(req, res) {
        try {
            const { deviceId } = req.params;
            // In real app, look up user by deviceId
            const mockUser = {
                address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
                balance: '1,250.50'
            };
            const passBuffer = await pass_service_1.PassService.generatePass(mockUser);
            res.set('Content-Type', 'application/vnd.apple.pkpass');
            res.set('Content-Disposition', `attachment; filename=xvault-${deviceId}.pkpass`);
            res.send(passBuffer);
        }
        catch (error) {
            console.error('Error in downloadPass:', error);
            res.status(500).json({ error: 'Failed to generate pass' });
        }
    }
    static async verifyDevice(req, res) {
        try {
            const deviceId = req.headers['x-device-library-id'];
            if (!deviceId) {
                res.status(403).json({ error: 'Device ID missing' });
                return;
            }
            // Verify against DB (mocked for now)
            // In production, check if deviceId exists in activeDevices table
            const isValid = true; // Assume valid for MVP demo
            if (!isValid) {
                res.status(403).json({ error: 'Invalid Device ID' });
                return;
            }
            res.status(200).json({ valid: true });
        }
        catch (error) {
            console.error('Error in verifyDevice:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}
exports.DeviceController = DeviceController;
