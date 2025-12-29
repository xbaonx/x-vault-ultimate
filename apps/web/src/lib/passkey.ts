import { startAuthentication } from '@simplewebauthn/browser';

/**
 * Signs a payload using the device's Passkey (WebAuthn Assertion).
 * This creates a cryptographic signature proving the user is present and using the authorized device.
 * 
 * @param challenge A random string from server to prevent replay attacks (nonce).
 * @param payload The data to sign (optional, usually implied by the challenge or request body).
 */
export async function signRequest(challenge: string) {
  try {
    // Start WebAuthn Assertion
    // We request an assertion for any credential on this device (empty allowCredentials)
    // or we could filter by specific credential ID if we tracked it.
    const assertion = await startAuthentication({
      challenge: challenge,
      timeout: 60000,
      userVerification: 'required', // Force FaceID/TouchID/PIN
      rpId: window.location.hostname === 'localhost' ? 'localhost' : undefined,
    });

    return assertion;
  } catch (error) {
    console.error('Request signing failed:', error);
    throw new Error('Failed to sign request with Passkey');
  }
}
