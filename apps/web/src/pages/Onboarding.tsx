import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Smartphone, Check, Loader2, Wallet } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { deviceService } from '../services/api';

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'start' | 'pairing' | 'success'>('start');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [passUrl, setPassUrl] = useState<string | null>(null);

  const startOnboarding = async () => {
    try {
      const data = await deviceService.register();
      setSessionId(data.sessionId);
      setStep('pairing');
    } catch (error) {
      console.error('Failed to start onboarding:', error);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (step === 'pairing' && sessionId) {
      interval = setInterval(async () => {
        try {
          const status = await deviceService.pollStatus(sessionId);
          if (status.status === 'completed') {
            setPassUrl(status.passUrl || null);
            setStep('success');
            clearInterval(interval);
          }
        } catch (error) {
          console.error('Polling error:', error);
        }
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [step, sessionId]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-surface border-surface/50">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold tracking-tighter mb-2">
            X-Vault
          </CardTitle>
          <CardDescription className="text-lg">
            Next Gen Web3 Wallet
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center min-h-[300px] space-y-8">
          {step === 'start' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-6"
            >
              <div className="bg-primary/10 p-6 rounded-full inline-block">
                <Wallet className="w-12 h-12 text-primary" />
              </div>
              <p className="text-secondary max-w-xs mx-auto">
                Create your secure wallet in seconds using your device biometrics.
              </p>
              <Button size="lg" onClick={startOnboarding} className="w-full">
                Create Wallet
              </Button>
            </motion.div>
          )}

          {step === 'pairing' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
                <div className="bg-surface border-2 border-primary/50 p-6 rounded-full inline-block relative z-10">
                  <Loader2 className="w-12 h-12 text-primary animate-spin" />
                </div>
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">Creating Secure Pass</h3>
                <p className="text-secondary text-sm">
                  Generating cryptographic keys on your device...
                </p>
              </div>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6"
            >
              <div className="bg-success/10 p-6 rounded-full inline-block">
                <Check className="w-12 h-12 text-success" />
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">Wallet Created!</h3>
                <p className="text-secondary text-sm mb-4">
                  Your X-Vault Pass is ready.
                </p>
                {passUrl && (
                  <a 
                    href={`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}${passUrl}`} 
                    className="inline-block bg-black border border-white/20 rounded-lg px-4 py-2 mb-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center space-x-2">
                       <Smartphone className="w-5 h-5" />
                       <span>Add to Apple Wallet</span>
                    </div>
                  </a>
                )}
              </div>
              <Button size="lg" onClick={() => navigate('/dashboard')} className="w-full">
                Enter Dashboard
              </Button>
            </motion.div>
          )}
        </CardContent>
        <CardFooter className="justify-center border-t border-white/5 pt-6">
          <p className="text-xs text-secondary">
            Secured by ERC-4337 & Secure Enclave
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
