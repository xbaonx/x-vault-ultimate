import React, { useRef, useState, useEffect } from 'react';

interface PinInputProps {
  length?: number;
  onComplete: (pin: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
}

export const PinInput: React.FC<PinInputProps> = ({ 
  length = 6, 
  onComplete, 
  label = "Enter PIN",
  error,
  disabled = false
}) => {
  const [pin, setPin] = useState<string[]>(new Array(length).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0]?.focus();
    }
  }, []);

  const handleChange = (index: number, value: string) => {
    if (isNaN(Number(value))) return;

    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);

    // Auto focus next
    if (value && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Check completion
    if (newPin.every(digit => digit !== '')) {
      onComplete(newPin.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!pin[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, length).split('');
    const newPin = [...pin];
    
    pastedData.forEach((value, index) => {
      if (index < length && !isNaN(Number(value))) {
        newPin[index] = value;
      }
    });
    
    setPin(newPin);
    
    if (pastedData.length === length) {
        onComplete(pastedData.join(''));
        inputRefs.current[length - 1]?.focus();
    } else if (pastedData.length < length) {
        inputRefs.current[pastedData.length]?.focus();
    }
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      {label && <p className="text-sm text-secondary mb-2">{label}</p>}
      <div className="flex gap-2">
        {pin.map((digit, index) => (
          <input
            key={index}
            ref={el => inputRefs.current[index] = el}
            type="text"
            inputMode="numeric"
            maxLength={1}
            disabled={disabled}
            value={digit}
            onChange={e => handleChange(index, e.target.value)}
            onKeyDown={e => handleKeyDown(index, e)}
            onPaste={handlePaste}
            className={`w-10 h-12 text-center text-xl font-bold bg-surface border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary transition-all
              ${error ? 'border-destructive text-destructive' : 'border-white/10 text-white'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          />
        ))}
      </div>
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  );
};
