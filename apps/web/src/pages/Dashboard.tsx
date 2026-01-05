import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownLeft, RefreshCw, Plus, ChevronDown, Wallet as WalletIcon, CreditCard, XCircle, Clock } from 'lucide-react';
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { migrationService, walletService } from "../services/api";
import { shortenAddress } from "../lib/utils";
import { MigrationModal } from '../components/MigrationModal';

export default function Dashboard() {
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<any>(null);
  const [address, setAddress] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pulling, setPulling] = useState(false);

  const CHAINS = [
    { chainId: 1, name: 'Ethereum' },
    { chainId: 8453, name: 'Base' },
    { chainId: 137, name: 'Polygon' },
    { chainId: 42161, name: 'Arbitrum' },
    { chainId: 10, name: 'Optimism' },
  ];
  const [selectedChainId, setSelectedChainId] = useState<number>(1);
  
  // Wallet Management
  const [wallets, setWallets] = useState<any[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [showWalletMenu, setShowWalletMenu] = useState(false);

  // Migration State
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<'initial' | 'pending' | 'ready'>('initial');
  const [migrationExpiry, setMigrationExpiry] = useState<string | undefined>(undefined);

  // Mock user ID for MVP
  const userId = localStorage.getItem('x_user_id') || 'user-123';
  const deviceId = localStorage.getItem('x_device_id') || 'device-123';
  const storedWalletId = localStorage.getItem('x_wallet_id');

  const formatCurrency = (value: number) => {
    const n = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  };

  // 1. Initial Load: Fetch Wallets & Device Status
  useEffect(() => {
      const init = async () => {
          try {
              setLoading(true);
              
              // Check Device Status (Migration/Auth)
              try {
                  const status = await migrationService.checkStatus(userId, deviceId);
                  if (status.status !== 'active') {
                      if (status.status === 'pending') {
                          setMigrationStatus(status.canFinalize ? 'ready' : 'pending');
                          setMigrationExpiry(status.expiry);
                          setShowMigrationModal(true);
                      }
                  }
              } catch (e: any) {
                  // If 403, device is invalid or unknown -> redirect or show modal
                  if (e.response?.status === 403) {
                      console.warn("Device not authorized:", e);
                  }
              }

              // Fetch Wallets
              const walletList = await walletService.listWallets(deviceId);
              setWallets(walletList);
              
              if (walletList.length > 0) {
                  const initial = (storedWalletId && walletList.some((w: any) => w.id === storedWalletId))
                    ? storedWalletId
                    : walletList[0].id;
                  setSelectedWalletId(initial);
                  localStorage.setItem('x_wallet_id', initial);
              }

          } catch (e: any) {
              console.error("Failed to initialize dashboard:", e);
              if (e.response?.status === 401 || e.response?.status === 403) {
                  localStorage.removeItem('x_user_id');
                  localStorage.removeItem('x_device_id');
                  window.location.href = '/onboarding';
              }
          } finally {
              setLoading(false);
          }
      };

      init();
  }, [userId, deviceId]);

  // 2. Fetch Portfolio when Selected Wallet Changes
  const fetchPortfolio = async (opts?: { refresh?: boolean }) => {
    if (!selectedWalletId) return;
    try {
      setLoading(true);
      setError(null);
      
      const [portfolioData, addressData] = await Promise.all([
        walletService.getPortfolio(userId, deviceId, selectedWalletId, !!opts?.refresh),
        walletService.getAddressByChain(userId, deviceId, selectedChainId, selectedWalletId)
      ]);
      
      setPortfolio(portfolioData);
      setAddress(addressData.address);
    } catch (error: any) {
      console.error('Error fetching dashboard data:', error);
      setError(error.response?.data?.error || 'Failed to load dashboard data');
      
      // Fallback
      setPortfolio({ totalBalanceUsd: 0, assets: [], history: [] });
      setAddress('0x00...');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchPortfolio({ refresh: true });
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateWallet = async () => {
    try {
      const name = window.prompt('Wallet name', `Wallet ${wallets.length + 1}`) || '';
      setLoading(true);
      const created = await walletService.createWallet(name, deviceId);

      const walletList = await walletService.listWallets(deviceId);
      setWallets(walletList);

      const newId = created?.id || walletList[walletList.length - 1]?.id;
      if (newId) {
        setSelectedWalletId(newId);
        localStorage.setItem('x_wallet_id', newId);
      }
      setShowWalletMenu(false);
    } catch (e: any) {
      console.error('Failed to create wallet:', e);
      setError(e?.response?.data?.error || 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPortfolio();
  }, [selectedWalletId, selectedChainId]);

  useEffect(() => {
    let startY = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0) return;
      if (refreshing) return;
      startY = e.touches[0]?.clientY || 0;
      active = true;
      setPulling(true);
      setPullDistance(0);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      if (window.scrollY > 0) return;
      const y = e.touches[0]?.clientY || 0;
      const delta = Math.max(0, y - startY);
      const capped = Math.min(120, delta);
      setPullDistance(capped);
    };

    const onTouchEnd = async () => {
      if (!active) return;
      const should = pullDistance >= 70;
      active = false;
      setPulling(false);
      setPullDistance(0);
      if (should) {
        await handleRefresh();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [pullDistance, refreshing, selectedWalletId]);

  const handleWalletSelect = (walletId: string) => {
      setSelectedWalletId(walletId);
      localStorage.setItem('x_wallet_id', walletId);
      setShowWalletMenu(false);
  };

  const handleMigrationSuccess = () => {
      setShowMigrationModal(false);
      // Refresh data or show success toast
      alert("Device successfully linked!");
  };

  const handleCancelTransaction = async (txId: string) => {
      if (!confirm("Are you sure you want to cancel this delayed transaction?")) return;
      
      try {
          await walletService.cancelTransaction(userId, txId, deviceId);
          alert("Transaction cancelled successfully.");
          fetchPortfolio(); // Refresh list
      } catch (e) {
          console.error("Failed to cancel", e);
          alert("Failed to cancel transaction.");
      }
  };

  const currentWallet = wallets.find(w => w.id === selectedWalletId);

  const getNormalizedApiUrl = () => {
    const url = import.meta.env.VITE_API_URL;
    if (!url) return 'http://localhost:3000';
    if (url.startsWith('http')) return url;
    if (url.includes('localhost')) return `http://${url}`;
    if (!url.includes('.')) return `https://${url}.onrender.com`;
    return `https://${url}`;
  };

  if (loading && !portfolio) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 pb-20">
      <div
        style={{ height: pulling || refreshing ? pullDistance : 0, transition: pulling ? 'none' : 'height 200ms ease' }}
        className="w-full flex items-center justify-center"
      >
        <div className="text-xs text-secondary">
          {refreshing ? 'Refreshing…' : (pulling ? (pullDistance >= 70 ? 'Release to refresh' : 'Pull to refresh') : '')}
        </div>
      </div>
      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}
      
      {/* Header */}
      <header className="flex justify-between items-center mb-8 pt-4">
        <div className="relative">
            <button 
                onClick={() => setShowWalletMenu(!showWalletMenu)}
                className="flex items-center space-x-2 hover:bg-white/10 p-2 rounded-lg transition-colors"
            >
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                    <span className="font-bold text-white">Z</span>
                </div>
                <div className="text-left">
                    <div className="font-bold text-lg flex items-center gap-1">
                        {currentWallet?.name || 'Zaur'}
                        <ChevronDown className="w-4 h-4 text-secondary" />
                    </div>
                </div>
            </button>

            {/* Wallet Dropdown */}
            {showWalletMenu && (
                <div className="absolute top-full left-0 mt-2 w-56 bg-surface border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2 space-y-1">
                        {wallets.map(w => (
                            <button
                                key={w.id}
                                onClick={() => handleWalletSelect(w.id)}
                                className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                                    w.id === selectedWalletId ? 'bg-white/10' : 'hover:bg-white/5'
                                }`}
                            >
                                <div className="bg-primary/20 p-2 rounded-full">
                                    <WalletIcon className="w-4 h-4 text-primary" />
                                </div>
                                <div>
                                    <div className="font-medium text-sm">{w.name}</div>
                                    <div className="text-[10px] text-secondary">{shortenAddress((w as any).aaAddresses?.[selectedChainId] || (w as any).aaAddress || w.address)}</div>
                                </div>
                            </button>
                        ))}
                        <div className="h-px bg-white/10 my-1" />
                        
                        <a 
                            href={`${getNormalizedApiUrl()}/api/device/pass/${deviceId}${selectedWalletId ? `?walletId=${selectedWalletId}` : ''}`}
                            className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-white/5 text-secondary hover:text-white transition-colors"
                        >
                            <div className="bg-white/10 p-2 rounded-full">
                                <CreditCard className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-sm">Add to Apple Wallet</span>
                        </a>

                        <button
                            onClick={handleCreateWallet}
                            className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-white/5 text-secondary hover:text-white transition-colors"
                        >
                            <div className="bg-white/10 p-2 rounded-full">
                                <Plus className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-sm">Create New Wallet</span>
                        </button>
                    </div>
                </div>
            )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedChainId}
            onChange={(e) => setSelectedChainId(Number(e.target.value))}
            className="bg-surface border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
          >
            {CHAINS.map((c) => (
              <option key={c.chainId} value={c.chainId}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="bg-surface px-3 py-1.5 rounded-full border border-white/10 text-sm font-mono text-secondary">
            {shortenAddress(address)}
          </div>
        </div>
      </header>

      {/* Main Balance */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h2 className="text-secondary text-sm font-medium mb-1">Total Balance</h2>
        <div className="text-5xl font-bold tracking-tight mb-6">
          {portfolio ? formatCurrency(portfolio.totalBalanceUsd) : '$0.00'}
        </div>
        
        <div className="flex justify-center gap-4">
          <Button 
            onClick={() => navigate('/app/send')}
            className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10"
          >
            <ArrowUpRight className="w-5 h-5 text-primary" />
            <span className="text-[10px] text-secondary">Send</span>
          </Button>
          <Button 
            onClick={() => navigate('/app/receive')}
            className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10"
          >
            <ArrowDownLeft className="w-5 h-5 text-success" />
            <span className="text-[10px] text-secondary">Receive</span>
          </Button>
          <Button 
            onClick={() => navigate('/app/swap')}
            className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10"
          >
            <RefreshCw className="w-5 h-5 text-blue-500" />
            <span className="text-[10px] text-secondary">Swap</span>
          </Button>
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin text-primary' : 'text-white'}`} />
            <span className="text-[10px] text-secondary">Refresh</span>
          </Button>
          <Button className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10">
            <Plus className="w-5 h-5 text-white" />
            <span className="text-[10px] text-secondary">Add</span>
          </Button>
        </div>
      </motion.div>

      {/* Assets */}
      {portfolio && (
          <div className="space-y-4 mb-8">
            <h3 className="text-lg font-semibold px-1">Assets</h3>
            {portfolio.assets.map((asset: any, index: number) => (
              <motion.div
                key={`${asset.symbol}-${asset.network}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="bg-surface/50 border-white/5 hover:bg-surface/80 transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                        {asset.symbol}
                      </div>
                      <div>
                        <div className="font-semibold">{asset.symbol}</div>
                        <div className="text-xs text-secondary capitalize">{asset.network}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatCurrency(asset.valueUsd)}</div>
                      <div className="text-xs text-secondary">{asset.balance} {asset.symbol}</div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
      )}

      {/* Recent Activity */}
      {portfolio && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold px-1">Recent Activity</h3>
            {portfolio.history.map((tx: any, index: number) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + (index * 0.1) }}
              >
                <Card className="bg-surface/30 border-white/5">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        tx.status === 'delayed' ? 'bg-yellow-500/20 text-yellow-500' :
                        tx.status === 'cancelled' ? 'bg-red-500/20 text-red-500' :
                        tx.type === 'receive' ? 'bg-success/20 text-success' : 'bg-white/10 text-white'
                      }`}>
                        {tx.status === 'delayed' ? <Clock className="w-4 h-4" /> :
                         tx.status === 'cancelled' ? <XCircle className="w-4 h-4" /> :
                         tx.type === 'receive' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="font-medium capitalize">{tx.type}</div>
                        <div className="text-xs text-secondary">{new Date(tx.date).toLocaleDateString()}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-medium ${tx.type === 'receive' ? 'text-success' : 'text-white'}`}>
                        {tx.type === 'receive' ? '+' : '-'}{tx.amount} {tx.token}
                      </div>
                      <div className="text-xs text-secondary capitalize flex justify-end items-center gap-1">
                          {tx.status === 'delayed' && <span className="text-yellow-500">Pending (48h)</span>}
                          {tx.status === 'cancelled' && <span className="text-red-500">Cancelled</span>}
                          {tx.status !== 'delayed' && tx.status !== 'cancelled' && tx.status}
                      </div>
                      
                      {tx.canCancel && (
                          <button 
                              onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelTransaction(tx.id);
                              }}
                              className="mt-2 text-[10px] bg-red-500/20 text-red-500 px-3 py-1.5 rounded-full hover:bg-red-500/30 flex items-center ml-auto transition-colors"
                          >
                              <XCircle className="w-3 h-3 mr-1" />
                              Cancel
                          </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
      )}

      <MigrationModal
        isOpen={showMigrationModal}
        userId={userId}
        deviceId={deviceId}
        initialStatus={migrationStatus}
        expiryDate={migrationExpiry}
        onSuccess={handleMigrationSuccess}
      />
    </div>
  );
}
