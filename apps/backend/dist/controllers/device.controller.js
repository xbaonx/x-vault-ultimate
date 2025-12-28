"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceController = void 0;
const uuid_1 = require("uuid");
const pass_service_1 = require("../services/pass.service");
const data_source_1 = require("../data-source");
const PollingSession_1 = require("../entities/PollingSession");
const User_1 = require("../entities/User");
class DeviceController {
    static async register(req, res) {
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
            console.log(`[Device] Created session: ${sessionId}.`);
            // In a real flow, this would return a URL/Token for the frontend to add to Apple Wallet
            // The Apple Wallet pass would then call back to a webhook when added (if supported)
            // or the user manually confirms.
            // For the "Magic Onboarding" simulation:
            // The frontend polls this sessionId.
            // We simulate a completion after some time or immediate for demo.
            // To simulate "Device Binding", we generate a unique device ID here
            const deviceLibraryId = (0, uuid_1.v4)();
            // Simulate async completion (in real world, this happens when the Pass is installed)
            setTimeout(async () => {
                try {
                    const session = await sessionRepo.findOneBy({ id: sessionId });
                    if (session) {
                        // Update session
                        session.status = 'completed';
                        session.deviceId = deviceLibraryId;
                        session.passUrl = `/api/device/pass/${deviceLibraryId}`;
                        await sessionRepo.save(session);
                        // Create Mock User for Dashboard visibility
                        // In real app, this happens after smart account deployment
                        const mockWalletAddress = `0x${deviceLibraryId.replace(/-/g, '').substring(0, 40)}`;
                        let user = await userRepo.findOneBy({ walletAddress: mockWalletAddress });
                        if (!user) {
                            user = userRepo.create({
                                walletAddress: mockWalletAddress,
                                deviceLibraryId: deviceLibraryId,
                                isBiometricEnabled: true
                            });
                            await userRepo.save(user);
                            console.log(`[Device] Created new user: ${user.id} (${mockWalletAddress})`);
                        }
                        console.log(`[Device] Completed session: ${sessionId}`);
                    }
                    else {
                        console.warn(`[Device] Session ${sessionId} not found during async completion.`);
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
