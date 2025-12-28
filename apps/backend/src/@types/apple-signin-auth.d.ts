declare module 'apple-signin-auth' {
  export interface AppleIdTokenType {
    iss: string;
    aud: string;
    exp: number;
    iat: number;
    sub: string;
    c_hash: string;
    email?: string;
    email_verified?: string;
    is_private_email?: string;
    auth_time: number;
    nonce_supported: boolean;
  }

  export interface VerifyIdTokenOptions {
    audience?: string | string[];
    nonce?: string;
    ignoreExpiration?: boolean;
  }

  export function verifyIdToken(
    idToken: string,
    options?: VerifyIdTokenOptions
  ): Promise<AppleIdTokenType>;

  export function getAuthorizationUrl(options: any): string;
  export function getAccessToken(options: any): Promise<any>;
  export function refreshAccessToken(refreshToken: string, options: any): Promise<any>;
}
