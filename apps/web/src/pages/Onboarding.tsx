import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, Loader2, Wallet, AlertTriangle, ShieldCheck, Lock } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';
import AppleSignin from 'react-apple-signin-auth';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { deviceService, authService, securityService } from '../services/api';
import { PinInput } from '../components/PinInput';

type OnboardingStep = 'siwa' | 'biometric' | 'pin-setup' | 'pairing' | 'success';

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>('siwa');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // State for flow data
  const [userId, setUserId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [passUrl, setPassUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // --- Step 1: Sign in with Apple ---
  const handleAppleResponse = async (response: any) => {
    setLoading(true);
    setError(null);
    try {
        if (response.error) {
            throw new Error(response.error);
        }

        const identityToken = response.authorization.id_token;
        const userStr = response.user ? JSON.stringify(response.user) : undefined;

        const data = await authService.loginWithApple(identityToken, userStr);
        
        setUserId(data.userId);
        setEmail(data.email);

        // Determine next step based on user status
        if (data.hasWallet && data.hasPin) {
            setStep('biometric');
        } else if (data.hasWallet && !data.hasPin) {
             setStep('biometric');
        } else {
            setStep('biometric');
        }

    } catch (err: any) {
        console.error("SIWA Error:", err);
        setError("Failed to sign in with Apple. " + (err.message || ''));
    } finally {
        setLoading(false);
    }
  };

  const handleAppleMock = async () => {
      // Mock flow for localhost only if configured
      console.warn("Using Mock Apple Sign In");
      handleAppleResponse({
          authorization: { id_token: `mock-identity-token-${Date.now()}` },
          user: { name: { firstName: 'Demo', lastName: 'User' }, email: 'demo@xvault.app' }
      });
  }

  // --- Step 2: Biometric (Passkey) Registration ---
  const startBiometricSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Get Registration Options (linked to userId from SIWA)
      const { options, tempUserId } = await deviceService.getRegistrationOptions(userId || undefined);
      
      // 2. Start WebAuthn Ceremony (FaceID/TouchID prompt)
      let attResp;
      try {
        attResp = await startRegistration(options);
      } catch (e: any) {
        if (e.name === 'NotAllowedError') {
          throw new Error('User cancelled the request or timed out.');
        }
        throw e;
      }

      // 3. Verify Response with Backend
      // Note: verifyRegistration now returns walletAddress and deviceLibraryId
      const verification = await deviceService.verifyRegistration(tempUserId, attResp);
      
      if (verification.verified) {
        setSessionId(verification.sessionId);
        setDeviceId(verification.deviceLibraryId);
        
        // Save device ID locally
        localStorage.setItem('x_device_id', verification.deviceLibraryId);
        if (userId) localStorage.setItem('x_user_id', userId);

        // Move to PIN setup
        setStep('pin-setup');
      } else {
        throw new Error('Verification failed on server.');
      }
    } catch (err: any) {
      console.error('Failed to create passkey:', err);
      setError(err.message || 'Failed to create secure credentials.');
    } finally {
      setLoading(false);
    }
  };

  // --- Step 3: PIN Setup ---
  const handlePinComplete = async (pin: string) => {
      if (!userId || !deviceId) {
          setError("Session invalid. Please restart.");
          return;
      }
      setLoading(true);
      try {
          await securityService.setPin(userId, pin, deviceId);
          // Success -> Start polling for Pass generation or just finish
          setStep('pairing');
      } catch (err: any) {
          setError(err.response?.data?.error || "Failed to set PIN");
      } finally {
          setLoading(false);
      }
  };

  // --- Polling for Apple Wallet Pass ---
  useEffect(() => {
    let interval: any;

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

  // Helper to normalize API URL for display/links
  const getNormalizedApiUrl = () => {
    const url = import.meta.env.VITE_API_URL;
    if (!url) return 'http://localhost:3000';
    if (url.startsWith('http')) return url;
    if (url.includes('localhost')) return `http://${url}`;
    if (!url.includes('.')) return `https://${url}.onrender.com`;
    return `https://${url}`;
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-surface border-surface/50 overflow-hidden relative">
        {loading && (
            <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
        )}

        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold tracking-tighter mb-2">
            X-Vault
          </CardTitle>
          <CardDescription className="text-lg">
            {step === 'siwa' && "Sign in to get started"}
            {step === 'biometric' && "Secure your Vault"}
            {step === 'pin-setup' && "Create Spending PIN"}
            {step === 'pairing' && "Finalizing Setup"}
            {step === 'success' && "You're all set!"}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="flex flex-col items-center justify-center min-h-[300px] space-y-8">
          
          {/* STEP 1: SIWA */}
          {step === 'siwa' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full space-y-6"
            >
               <div className="flex justify-center mb-8">
                   <div className="bg-white/5 p-6 rounded-full">
                       <ShieldCheck className="w-16 h-16 text-white" />
                   </div>
               </div>
               
               <div className="space-y-4">
                  {/* Apple Sign In Button */}
                  <div className="flex justify-center w-full">
                    <AppleSignin
                        authOptions={{
                            clientId: import.meta.env.VITE_APPLE_CLIENT_ID || 'com.xvault.app',
                            scope: 'email name',
                            redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI || window.location.origin,
                            usePopup: true,
                            nonce: 'nonce',
                        }}
                        uiType="dark"
                        className="apple-auth-btn"
                        noDefaultStyle={false}
                        buttonExtraChildren="Sign in with Apple"
                        onSuccess={handleAppleResponse}
                        onError={(error: any) => {
                            console.error(error);
                            setError("Apple Sign In failed: " + (error.error || "Unknown"));
                        }}
                        skipScript={false}
                        render={(props: any) => (
                            <button
                                {...props}
                                className="w-full bg-white text-black hover:bg-gray-100 font-semibold h-12 rounded-lg flex items-center justify-center gap-2 transition-all border border-gray-200"
                            >
                                 <svg className="w-5 h-5 mb-1" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-.92-.4-1.9-.4-2.82.02-.95.42-1.95.45-2.92-.37C5.55 17.5 4.5 13.84 6.7 9.8c1.1-1.96 2.92-2.3 4.02-1.6 1 .58 1.83.65 2.87-.04.9-.53 2.56-.7 3.8.76.2.22.38.47.54.74-.02.04-.6.23-.62.25-1.78.85-2.12 3.1-.64 4.52.4.4.8.7 1.25.9-.6.8-1.04 1.4-1.47 1.95zm-3.3-16.7c.6-1.5 2.45-2.58 4.2-2.58.12 1.63-.82 3.4-2.35 4.23-.65.37-1.37.58-2.08.56-.1-1.72.63-3.23 2.22-4.2z" />
                                </svg>
                                Sign in with Apple
                            </button>
                        )}
                    />
                  </div>

                  {/* Dev Only Mock Button - Hidden in Prod */}
                  {import.meta.env.DEV && (
                       <Button variant="ghost" size="sm" onClick={handleAppleMock} className="w-full text-xs text-gray-400">
                          (Dev Only: Mock Sign In)
                       </Button>
                  )}

                  <p className="text-xs text-center text-secondary">
                      By signing in, you agree to our Terms of Service and Privacy Policy.
                  </p>
               </div>
            </motion.div>
          )}

          {/* STEP 2: BIOMETRIC */}
          {step === 'biometric' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-center space-y-6 w-full"
            >
              <div className="bg-primary/10 p-6 rounded-full inline-block">
                <Wallet className="w-12 h-12 text-primary" />
              </div>
              <div className="space-y-2">
                  <h3 className="font-semibold text-xl text-white">Enable FaceID</h3>
                  {email && (
                    <p className="text-sm text-secondary font-medium bg-white/5 py-1 px-3 rounded-full inline-block mb-2">
                        {email}
                    </p>
                  )}
                  <p className="text-secondary max-w-xs mx-auto">
                    X-Vault uses Secure Enclave to protect your private keys.
                  </p>
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 p-3 rounded-lg flex items-center gap-2 text-destructive text-sm text-left">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
              )}

              <Button size="lg" onClick={startBiometricSetup} className="w-full">
                Create Passkey
              </Button>
            </motion.div>
          )}

          {/* STEP 3: PIN SETUP */}
          {step === 'pin-setup' && (
             <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-center space-y-6 w-full"
             >
                <div className="bg-orange-500/10 p-6 rounded-full inline-block">
                    <Lock className="w-12 h-12 text-orange-500" />
                </div>
                
                <div className="space-y-2">
                    <h3 className="font-semibold text-xl text-white">Set Spending PIN</h3>
                    <p className="text-secondary max-w-xs mx-auto text-sm">
                        This 6-digit PIN will be required for transactions over $500.
                    </p>
                </div>

                <PinInput 
                    length={6} 
                    onComplete={handlePinComplete} 
                    disabled={loading}
                    error={error || undefined}
                />
             </motion.div>
          )}

          {/* STEP 4: PAIRING/LOADING */}
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
                <h3 className="text-xl font-semibold mb-2">Finalizing</h3>
                <p className="text-secondary text-sm">
                  Generating your Apple Wallet Pass...
                </p>
              </div>
            </motion.div>
          )}

          {/* STEP 5: SUCCESS */}
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
                <h3 className="text-xl font-semibold mb-2">Welcome to X-Vault</h3>
                <p className="text-secondary text-sm mb-4">
                  Your secure wallet is ready.
                </p>
                {passUrl && (
                  <a 
                    href={`${getNormalizedApiUrl()}${passUrl}`} 
                    className="inline-block hover:opacity-80 transition-opacity"
                  >
                    <img 
                      src="https://developer.apple.com/assets/elements/badges/add-to-apple-wallet.svg" 
                      alt="Add to Apple Wallet" 
                      className="h-12"
                    />
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
