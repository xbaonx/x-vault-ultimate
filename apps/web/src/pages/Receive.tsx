import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Share2, CheckCircle, Wallet } from 'lucide-react';
import QRCode from 'react-qr-code';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { walletService } from '../services/api';
import { shortenAddress } from '../lib/utils';

const CHAINS = [
  { chainId: 1, name: 'Ethereum' },
  { chainId: 8453, name: 'Base' },
  { chainId: 137, name: 'Polygon' },
  { chainId: 42161, name: 'Arbitrum' },
  { chainId: 10, name: 'Optimism' },
];

export default function Receive() {
  const navigate = useNavigate();
  const [address, setAddress] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [selectedChainId, setSelectedChainId] = useState<number>(1);

  const userId = localStorage.getItem('x_user_id') || '';
  const deviceId = localStorage.getItem('x_device_id') || '';
  const walletId = localStorage.getItem('x_wallet_id') || '';

  useEffect(() => {
    const fetchAddress = async () => {
      try {
        const data = await walletService.getAddressByChain(userId, deviceId, selectedChainId, walletId || undefined);
        setAddress(data.address);
      } catch (error) {
        console.error("Failed to fetch address", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAddress();
  }, [userId, deviceId, walletId, selectedChainId]);

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (navigator.share && address) {
      try {
        await navigator.share({
          title: 'My Zaur Wallet Address',
          text: address,
        });
      } catch (err) {
        console.error('Share failed', err);
      }
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
        <h1 className="text-xl font-bold">Receive Assets</h1>
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="max-w-md mx-auto space-y-6 flex flex-col items-center">
            <Card className="bg-white p-6 rounded-3xl w-full aspect-square flex items-center justify-center max-w-[300px]">
                <div className="w-full h-full flex items-center justify-center">
                    {address && (
                        <QRCode 
                            value={address} 
                            size={256}
                            style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                            viewBox={`0 0 256 256`}
                        />
                    )}
                </div>
            </Card>

            <div className="text-center space-y-2 w-full">
                <div className="flex items-center justify-center gap-2">
                  <p className="text-secondary text-sm">Network</p>
                  <select
                    value={selectedChainId}
                    onChange={(e) => setSelectedChainId(Number(e.target.value))}
                    className="bg-surface border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
                  >
                    {CHAINS.map((c) => (
                      <option key={c.chainId} value={c.chainId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div 
                    onClick={handleCopy}
                    className="bg-surface border border-white/10 p-4 rounded-xl flex items-center justify-between cursor-pointer active:bg-white/5 transition-colors"
                >
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="bg-primary/20 p-2 rounded-full min-w-[36px]">
                            <Wallet className="w-5 h-5 text-primary" />
                        </div>
                        <code className="text-sm font-mono truncate text-white block w-full text-left">{shortenAddress(address)}</code>
                    </div>
                    {copied ? (
                        <CheckCircle className="w-5 h-5 text-success flex-shrink-0" />
                    ) : (
                        <Copy className="w-5 h-5 text-secondary flex-shrink-0" />
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 w-full">
                <Button 
                    onClick={handleCopy}
                    className="h-12 bg-white text-black hover:bg-gray-200 font-semibold"
                >
                    <Copy className="w-4 h-4 mr-2" />
                    {copied ? "Copied" : "Copy"}
                </Button>
                <Button 
                    variant="outline"
                    className="h-12 border-white/20 hover:bg-white/10 text-white font-semibold"
                    onClick={handleShare}
                >
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                </Button>
            </div>

            <p className="text-xs text-secondary text-center max-w-xs leading-relaxed mt-4">
                Send only ETH, POL, USDC, USDT, DAI and other supported tokens to this address. Sending other assets may result in permanent loss.
            </p>
        </div>
      )}
    </div>
  );
}
