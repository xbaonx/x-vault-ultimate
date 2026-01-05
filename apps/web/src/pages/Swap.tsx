import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowDownUp } from 'lucide-react';
import { ethers } from 'ethers';
import { Button } from '../components/ui/button';
import { walletService } from '../services/api';

// WETH/WMATIC Contract Addresses
const WRAPPED_TOKENS: Record<number, { address: string; symbol: string; name: string }> = {
    8453: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether' }, // Base
    137: { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WMATIC', name: 'Wrapped Matic' }, // Polygon
    42161: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', name: 'Wrapped Ether' }, // Arbitrum
    10: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether' }, // Optimism
    1: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether' } // Mainnet
};

export default function Swap() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [swapping, setSwapping] = useState(false);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [selectedChainId, setSelectedChainId] = useState<number>(8453); // Default Base
  const [amount, setAmount] = useState('');
  const [isUnwrap, setIsUnwrap] = useState(false); // false = ETH->WETH, true = WETH->ETH
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const userId = localStorage.getItem('x_user_id') || '';
  const deviceId = localStorage.getItem('x_device_id') || '';

  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        const data = await walletService.getPortfolio(userId, deviceId);
        setPortfolio(data);
        // Try to detect current chain from assets or default to Base
        if (data.assets && data.assets.length > 0) {
             const native = data.assets.find((a: any) => a.isNative);
             if (native) setSelectedChainId(native.chainId);
        }
      } catch (err) {
        console.error("Failed to fetch portfolio", err);
      } finally {
        setLoading(false);
      }
    };
    fetchPortfolio();
  }, [userId, deviceId]);

  const handleSwap = async () => {
    setError(null);
    setSuccess(null);

    if (!amount || parseFloat(amount) <= 0) {
        setError("Invalid amount");
        return;
    }

    const wrappedToken = WRAPPED_TOKENS[selectedChainId];
    if (!wrappedToken) {
        setError("Unsupported network for swapping");
        return;
    }

    setSwapping(true);
    try {
        let transaction;
        
        if (!isUnwrap) {
            // WRAP: ETH -> WETH
            // Deposit Native Token to Wrapped Contract
            // Function: deposit() 
            // Signature: 0xd0e30db0
            transaction = {
                to: wrappedToken.address,
                value: ethers.parseEther(amount).toString(),
                data: '0xd0e30db0', 
                chainId: selectedChainId
            };
        } else {
            // UNWRAP: WETH -> ETH
            // Withdraw from Wrapped Contract
            // Function: withdraw(uint256)
            // Signature: 0x2e1a7d4d
            
            const iface = new ethers.Interface(["function withdraw(uint256 amount)"]);
            const amountWei = ethers.parseEther(amount);
            const data = iface.encodeFunctionData("withdraw", [amountWei]);

            transaction = {
                to: wrappedToken.address,
                value: '0',
                data: data,
                chainId: selectedChainId
            };
        }

        console.log("Swap Transaction:", transaction);

        const result = await walletService.sendTransaction(userId, transaction, deviceId);

        console.log("Swap Result:", result);
        setSuccess(`Swap Submitted! Hash: ${result.txHash}`);
        setAmount('');
        
        if (result.explorerUrl) {
            window.open(result.explorerUrl, '_blank');
        }

    } catch (err: any) {
        console.error("Swap failed:", err);
        setError(err.response?.data?.error || err.message || "Swap failed");
    } finally {
        setSwapping(false);
    }
  };

  const getNativeBalance = () => {
      if (!portfolio) return '0.00';
      const native = portfolio.assets.find((a: any) => a.chainId === selectedChainId && a.isNative);
      return native ? native.balance.toString() : '0.00';
  };

  const getWrappedBalance = () => {
      // Since we don't explicitly fetch WETH balance in wallet controller yet unless it's in the token list,
      // we might show 0 if not indexed. 
      // For now, let's rely on what's in portfolio.assets
      if (!portfolio) return '0.00';
      const wrapped = portfolio.assets.find((a: any) => a.chainId === selectedChainId && !a.isNative && a.symbol === WRAPPED_TOKENS[selectedChainId]?.symbol);
      return wrapped ? wrapped.balance.toString() : '0.00';
  };

  const currentToken = WRAPPED_TOKENS[selectedChainId];
  const nativeSymbol = currentToken?.symbol === 'WMATIC' ? 'POL' : 'ETH';

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
        <h1 className="text-xl font-bold">Swap</h1>
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="max-w-md mx-auto space-y-6">
            
            {/* Chain Selector (Simplified) */}
            <div className="flex gap-2 overflow-x-auto pb-2">
                {Object.entries(WRAPPED_TOKENS).map(([id, token]) => (
                    <button
                        key={id}
                        onClick={() => setSelectedChainId(Number(id))}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                            selectedChainId === Number(id) 
                            ? 'bg-primary text-white' 
                            : 'bg-surface border border-white/10 text-secondary hover:bg-white/10'
                        }`}
                    >
                        {token.symbol === 'WMATIC' ? 'Polygon' : 
                         id === '8453' ? 'Base' : 
                         id === '42161' ? 'Arbitrum' : 
                         id === '10' ? 'Optimism' : 'Ethereum'}
                    </button>
                ))}
            </div>

            <div className="relative">
                {/* Input Card */}
                <div className="bg-surface border border-white/10 rounded-2xl p-4 space-y-4">
                    <div className="flex justify-between items-center">
                        <span className="text-secondary text-sm">Pay</span>
                        <span className="text-xs text-secondary">
                            Balance: {isUnwrap ? getWrappedBalance() : getNativeBalance()}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <input 
                            type="number" 
                            placeholder="0.0"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="bg-transparent text-3xl font-medium outline-none w-2/3 placeholder-white/20"
                        />
                        <div className="bg-black/50 px-3 py-1.5 rounded-full flex items-center gap-2">
                            <span className="font-bold">{isUnwrap ? currentToken?.symbol : nativeSymbol}</span>
                        </div>
                    </div>
                </div>

                {/* Switch Button */}
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 top-1/2 z-10">
                    <button 
                        onClick={() => setIsUnwrap(!isUnwrap)}
                        className="bg-surface border border-white/10 p-2 rounded-full hover:bg-white/10 transition-colors"
                    >
                        <ArrowDownUp className="w-5 h-5 text-primary" />
                    </button>
                </div>

                {/* Output Card */}
                <div className="bg-surface border border-white/10 rounded-2xl p-4 space-y-4 mt-2">
                    <div className="flex justify-between items-center">
                        <span className="text-secondary text-sm">Receive</span>
                        <span className="text-xs text-secondary">
                            Balance: {!isUnwrap ? getWrappedBalance() : getNativeBalance()}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="text-3xl font-medium text-white/50">
                            {amount || '0.0'}
                        </div>
                        <div className="bg-black/50 px-3 py-1.5 rounded-full flex items-center gap-2">
                            <span className="font-bold">{!isUnwrap ? currentToken?.symbol : nativeSymbol}</span>
                        </div>
                    </div>
                </div>
            </div>

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

            <Button 
                onClick={handleSwap}
                disabled={swapping || !currentToken}
                className="w-full h-14 text-lg font-bold rounded-xl"
            >
                {swapping ? (
                    <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Signing...
                    </div>
                ) : (
                    isUnwrap ? `Unwrap ${currentToken?.symbol}` : `Wrap ${nativeSymbol}`
                )}
            </Button>

            <p className="text-center text-xs text-secondary mt-4">
                1 {nativeSymbol} = 1 {currentToken?.symbol} (Fixed Rate)
            </p>
        </div>
      )}
    </div>
  );
}
