import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Info } from 'lucide-react';
import { ethers } from 'ethers';
import { Button } from '../components/ui/button';
import { walletService } from '../services/api';

export default function Send() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fee, setFee] = useState<any>(null);

  const userId = localStorage.getItem('x_user_id') || '';
  const deviceId = localStorage.getItem('x_device_id') || '';

  // 1. Fetch Portfolio to populate asset list
  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        const data = await walletService.getPortfolio(userId, deviceId);
        setPortfolio(data);
        if (data.assets && data.assets.length > 0) {
            setSelectedAsset(data.assets[0]);
        }
      } catch (err) {
        console.error("Failed to fetch portfolio", err);
        setError("Failed to load assets.");
      } finally {
        setLoading(false);
      }
    };
    fetchPortfolio();
  }, [userId, deviceId]);

  const handleSend = async () => {
    setError(null);
    setSuccess(null);
    setFee(null);

    // Validation
    if (!recipient || !ethers.isAddress(recipient)) {
        setError("Invalid recipient address");
        return;
    }
    if (!amount || parseFloat(amount) <= 0) {
        setError("Invalid amount");
        return;
    }
    if (parseFloat(amount) > selectedAsset.balance) {
        setError("Insufficient balance");
        return;
    }
    if (!selectedAsset) {
        setError("No asset selected");
        return;
    }

    setSending(true);
    try {
        let transaction;
        
        // Construct Transaction Data
        if (selectedAsset.isNative) {
            // Native Transfer (ETH, MATIC)
            transaction = {
                to: recipient,
                value: ethers.parseEther(amount).toString(),
                data: '0x',
                chainId: selectedAsset.chainId,
                isNative: true,
                assetSymbol: selectedAsset.symbol,
                decimals: 18
            };
        } else {
            // ERC-20 Transfer
            const iface = new ethers.Interface([
                "function transfer(address to, uint256 amount) returns (bool)"
            ]);
            const decimals = selectedAsset.decimals || 18;
            const amountWei = ethers.parseUnits(amount, decimals);
            
            const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);

            transaction = {
                to: selectedAsset.tokenAddress, // Contract Address
                value: '0', // 0 Native Value
                data: data,
                chainId: selectedAsset.chainId,
                isNative: false,
                assetSymbol: selectedAsset.symbol,
                decimals
            };
        }

        console.log("Sending Transaction:", transaction);

        // Call API (Triggers Passkey)
        const result = await walletService.sendTransaction(userId, transaction, deviceId);

        if (result.fee) {
            setFee(result.fee);
        }

        console.log("Transaction Result:", result);
        
        if (result.delayed) {
            setSuccess(null); // Clear generic success
            // Show specific delay message
            setError(null);
            // We can use a separate state for delayed status or reuse success with a prefix
            // Let's use a specific UI for delay
            setSuccess(`🔒 SECURITY DELAY: ${result.message}`);
        } else {
            setSuccess(`Transaction Submitted! Hash: ${result.txHash}`);
            if (result.explorerUrl) {
                window.open(result.explorerUrl, '_blank');
            }
        }
        
        setAmount('');
        setRecipient('');

    } catch (err: any) {
        console.error("Send failed:", err);
        setError(err.response?.data?.error || err.message || "Transaction failed");
    } finally {
        setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 pb-20">
      <header className="flex items-center mb-8 pt-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate('/dashboard')}
          className="mr-2 text-white hover:bg-white/10"
        >
          <ArrowLeft className="w-6 h-6" />
        </Button>
        <h1 className="text-xl font-bold">Send Assets</h1>
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="max-w-md mx-auto space-y-6">
            
            {/* Asset Selection */}
            <div className="space-y-2">
                <label className="text-secondary text-sm ml-1">Asset</label>
                <div className="relative">
                    <select 
                        className="w-full bg-surface border border-white/10 rounded-xl p-4 appearance-none outline-none focus:border-primary transition-colors text-white font-medium"
                        value={selectedAsset ? JSON.stringify(selectedAsset) : ''}
                        onChange={(e) => setSelectedAsset(JSON.parse(e.target.value))}
                    >
                        {portfolio?.assets.map((asset: any) => (
                            <option key={`${asset.symbol}-${asset.network}`} value={JSON.stringify(asset)}>
                                {asset.symbol} ({asset.network}) - Balance: {asset.balance}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary pointer-events-none" />
                </div>
            </div>

            {/* Amount Input */}
            <div className="space-y-2">
                <label className="text-secondary text-sm ml-1">Amount</label>
                <div className="relative">
                    <input 
                        type="number" 
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full bg-surface border border-white/10 rounded-xl p-4 outline-none focus:border-primary transition-colors text-white font-mono text-lg"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-secondary font-medium">
                        {selectedAsset?.symbol}
                    </div>
                </div>
                {selectedAsset && (
                    <div className="flex justify-between px-1">
                        <span className="text-xs text-secondary">
                            Available: {selectedAsset.balance} {selectedAsset.symbol}
                        </span>
                        <button 
                            onClick={() => setAmount(selectedAsset.balance.toString())}
                            className="text-xs text-primary font-medium hover:text-primary/80"
                        >
                            Max
                        </button>
                    </div>
                )}
            </div>

            {/* Recipient Input */}
            <div className="space-y-2">
                <label className="text-secondary text-sm ml-1">To Address</label>
                <input 
                    type="text" 
                    placeholder="0x..."
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="w-full bg-surface border border-white/10 rounded-xl p-4 outline-none focus:border-primary transition-colors text-white font-mono text-sm"
                />
            </div>

            {/* Info Box */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-200/80 leading-relaxed">
                    Transactions are secured by Passkey (FaceID / TouchID). Ensure you are on the correct network ({selectedAsset?.network}) before sending.
                </div>
            </div>

            {fee && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                    <div className="text-sm font-semibold">Fee Breakdown</div>
                    <div className="text-xs text-secondary flex justify-between">
                        <span>Gas fee (0.3%)</span>
                        <span className="font-mono">
                            {fee.assetSymbol === selectedAsset?.symbol
                                ? ethers.formatUnits(fee.gasFee, selectedAsset?.decimals || 18)
                                : fee.gasFee}
                            {' '}{fee.assetSymbol}
                        </span>
                    </div>
                    <div className="text-xs text-secondary flex justify-between">
                        <span>Platform fee (0.5%)</span>
                        <span className="font-mono">
                            {fee.assetSymbol === selectedAsset?.symbol
                                ? ethers.formatUnits(fee.platformFee, selectedAsset?.decimals || 18)
                                : fee.platformFee}
                            {' '}{fee.assetSymbol}
                        </span>
                    </div>
                    <div className="text-xs text-secondary flex justify-between">
                        <span>Recipient receives (net)</span>
                        <span className="font-mono">
                            {fee.assetSymbol === selectedAsset?.symbol
                                ? ethers.formatUnits(fee.netAmount, selectedAsset?.decimals || 18)
                                : fee.netAmount}
                            {' '}{fee.assetSymbol}
                        </span>
                    </div>
                    <div className="text-xs text-secondary">
                        Platform fee mode: {fee.platformFeeChargedOnChain ? 'on-chain' : fee.platformFeeChargedUsdZ ? 'USDZ' : 'n/a'}
                    </div>
                </div>
            )}

            {/* Status Messages */}
            {error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-destructive text-sm font-medium">
                    {error}
                </div>
            )}

            {success && (
                <div className="bg-success/10 border border-success/20 rounded-xl p-4 text-success text-sm font-medium break-all">
                    {success}
                </div>
            )}

            {/* Submit Button */}
            <Button 
                onClick={handleSend}
                disabled={sending || !selectedAsset}
                className="w-full h-14 text-lg font-bold rounded-xl mt-4"
            >
                {sending ? (
                    <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Signing...
                    </div>
                ) : (
                    "Confirm Send"
                )}
            </Button>
        </div>
      )}
    </div>
  );
}
