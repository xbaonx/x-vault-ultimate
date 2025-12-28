import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, X } from 'lucide-react';
import { PinInput } from './PinInput';

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (pin: string) => void;
  title?: string;
  description?: string;
  error?: string;
  isLoading?: boolean;
}

export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  title = "Security Check",
  description = "Enter your Spending PIN to authorize this transaction.",
  error,
  isLoading
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 500 }}
            className="fixed z-50 w-full max-w-md bg-surface border border-white/10 rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 bottom-0 sm:bottom-auto"
          >
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-secondary hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="flex flex-col items-center space-y-6 pt-2 pb-8">
              <div className="bg-primary/10 p-4 rounded-full">
                <ShieldCheck className="w-10 h-10 text-primary" />
              </div>

              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="text-secondary text-sm max-w-[260px] mx-auto">
                  {description}
                </p>
              </div>

              <div className="w-full">
                <PinInput 
                  length={6} 
                  onComplete={onComplete}
                  disabled={isLoading}
                  error={error}
                />
              </div>

              {isLoading && (
                <div className="text-sm text-primary animate-pulse">
                  Verifying...
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
