import React from 'react';
import { Button } from './ui/button';

interface AppleSignInButtonProps {
  onClick: () => void;
  isLoading?: boolean;
}

export const AppleSignInButton: React.FC<AppleSignInButtonProps> = ({ onClick, isLoading }) => {
  return (
    <Button 
      onClick={onClick}
      disabled={isLoading}
      className="w-full bg-white text-black hover:bg-gray-100 font-semibold h-12 rounded-lg flex items-center justify-center gap-2 transition-all"
    >
      {isLoading ? (
        <span className="animate-pulse">Connecting...</span>
      ) : (
        <>
          <svg className="w-5 h-5 mb-1" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-.92-.4-1.9-.4-2.82.02-.95.42-1.95.45-2.92-.37C5.55 17.5 4.5 13.84 6.7 9.8c1.1-1.96 2.92-2.3 4.02-1.6 1 .58 1.83.65 2.87-.04.9-.53 2.56-.7 3.8.76.2.22.38.47.54.74-.02.04-.6.23-.62.25-1.78.85-2.12 3.1-.64 4.52.4.4.8.7 1.25.9-.6.8-1.04 1.4-1.47 1.95zm-3.3-16.7c.6-1.5 2.45-2.58 4.2-2.58.12 1.63-.82 3.4-2.35 4.23-.65.37-1.37.58-2.08.56-.1-1.72.63-3.23 2.22-4.2z" />
          </svg>
          Sign in with Apple
        </>
      )}
    </Button>
  );
};
