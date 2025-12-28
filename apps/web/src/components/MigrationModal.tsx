import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Clock, CheckCircle, Smartphone } from 'lucide-react';
import { Button } from './ui/button';
import { migrationService } from '../services/api';

interface MigrationModalProps {
  isOpen: boolean;
  userId: string;
  deviceId: string;
  initialStatus?: 'initial' | 'pending' | 'ready';
  expiryDate?: string;
  onSuccess: () => void;
}

export const MigrationModal: React.FC<MigrationModalProps> = ({
  isOpen,
  userId,
  deviceId,
  initialStatus = 'initial',
  expiryDate,
  onSuccess
}) => {
  const [status, setStatus] = useState<'initial' | 'pending' | 'ready' | 'success'>(initialStatus);
  const [expiry, setExpiry] = useState<Date | null>(expiryDate ? new Date(expiryDate) : null);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
    if (expiryDate) setExpiry(new Date(expiryDate));
  }, [initialStatus, expiryDate]);

  // Timer for pending state
  useEffect(() => {
    let interval: any;
    if (status === 'pending' && expiry) {
      const updateTimer = () => {
        const now = new Date();
        const diff = expiry.getTime() - now.getTime();
        
        if (diff <= 0) {
          setStatus('ready');
          clearInterval(interval);
        } else {
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          setTimeLeft(`${hours}h ${minutes}m`);
        }
      };
      
      updateTimer();
      interval = setInterval(updateTimer, 60000); // Update every minute
    }
    return () => clearInterval(interval);
  }, [status, expiry]);

  const handleInitiate = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await migrationService.initiateMigration(userId, deviceId);
      if (res.status === 'pending') {
        setStatus('pending');
        setExpiry(new Date(res.expiry));
      }
    } catch (err: any) {
      console.error("Migration initiate error:", err);
      setError(err.response?.data?.error || "Failed to start migration");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalize = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await migrationService.finalizeMigration(userId, deviceId);
      setStatus('success');
      setTimeout(() => {
        onSuccess();
      }, 2000);
    } catch (err: any) {
      console.error("Migration finalize error:", err);
      setError(err.response?.data?.error || "Failed to finalize migration");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-md z-[60] flex items-center justify-center p-4"
          />
          
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="fixed z-[70] w-full max-w-md bg-surface border border-white/10 rounded-3xl p-6 shadow-2xl"
          >
            {/* CONTENT BASED ON STATUS */}
            <div className="flex flex-col items-center text-center space-y-6">
              
              {status === 'initial' && (
                <>
                  <div className="bg-destructive/20 p-4 rounded-full">
                    <Smartphone className="w-12 h-12 text-destructive" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-white">New Device Detected</h3>
                    <p className="text-secondary text-sm">
                      This device is not linked to your X-Vault. 
                      To use it, you must initiate a device migration.
                    </p>
                    <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg text-xs text-yellow-500 text-left mt-4">
                        <div className="flex items-center gap-2 mb-1 font-bold">
                            <ShieldAlert className="w-4 h-4" />
                            Security Delay
                        </div>
                        Linking a new device triggers a 48-hour security delay to protect your assets.
                    </div>
                  </div>
                  <Button onClick={handleInitiate} disabled={isLoading} className="w-full" variant="destructive">
                    {isLoading ? "Starting..." : "Link This Device"}
                  </Button>
                </>
              )}

              {status === 'pending' && (
                <>
                  <div className="bg-yellow-500/20 p-4 rounded-full animate-pulse">
                    <Clock className="w-12 h-12 text-yellow-500" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-white">Security Delay Active</h3>
                    <p className="text-secondary text-sm">
                      Migration in progress. Your wallet is currently locked for security.
                    </p>
                    <div className="py-4">
                        <div className="text-3xl font-mono font-bold text-white">{timeLeft}</div>
                        <div className="text-xs text-secondary mt-1">Remaining</div>
                    </div>
                    <p className="text-xs text-secondary">
                        Check your email for instructions if you did not request this.
                    </p>
                  </div>
                  <Button disabled className="w-full opacity-50 cursor-not-allowed">
                    Waiting for Security Delay...
                  </Button>
                </>
              )}

              {status === 'ready' && (
                <>
                  <div className="bg-success/20 p-4 rounded-full">
                    <CheckCircle className="w-12 h-12 text-success" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-white">Ready to Link</h3>
                    <p className="text-secondary text-sm">
                      Security delay has passed. You can now finalize the migration to this device.
                    </p>
                  </div>
                  <Button onClick={handleFinalize} disabled={isLoading} className="w-full bg-success hover:bg-success/80 text-white">
                    {isLoading ? "Finalizing..." : "Add to Apple Wallet"}
                  </Button>
                </>
              )}

              {status === 'success' && (
                <>
                  <div className="bg-success/20 p-4 rounded-full">
                    <CheckCircle className="w-12 h-12 text-success" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-white">Device Linked!</h3>
                    <p className="text-secondary text-sm">
                      Your wallet is now fully active on this device.
                    </p>
                  </div>
                </>
              )}

              {error && (
                <div className="text-destructive text-sm bg-destructive/10 p-2 rounded w-full">
                    {error}
                </div>
              )}

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
