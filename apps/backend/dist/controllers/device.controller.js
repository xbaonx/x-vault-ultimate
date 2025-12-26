"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceController = void 0;
const uuid_1 = require("uuid");
const pass_service_1 = require("../services/pass.service");
// In-memory storage for polling sessions (replace with Redis/DB in production)
const pollingSessions = new Map();
class DeviceController {
    static async register(req, res) {
        try {
            // Start a new polling session
            const sessionId = (0, uuid_1.v4)();
            pollingSessions.set(sessionId, { status: 'pending' });
            // In a real flow, this would return a URL/Token for the frontend to add to Apple Wallet
            // The Apple Wallet pass would then call back to a webhook when added (if supported)
            // or the user manually confirms.
            // For the "Magic Onboarding" simulation:
            // The frontend polls this sessionId.
            // We simulate a completion after some time or immediate for demo.
            // To simulate "Device Binding", we generate a unique device ID here
            const deviceLibraryId = (0, uuid_1.v4)();
            // Simulate async completion (in real world, this happens when the Pass is installed)
            setTimeout(() => {
                pollingSessions.set(sessionId, {
                    status: 'completed',
                    deviceId: deviceLibraryId,
                    passUrl: `/api/device/pass/${deviceLibraryId}`
                });
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
            const session = pollingSessions.get(sessionId);
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
