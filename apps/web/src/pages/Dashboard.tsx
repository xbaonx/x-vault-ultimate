import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownLeft, CreditCard, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { walletService } from '../services/api';
import { formatCurrency, shortenAddress } from '../lib/utils';

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<any>(null);
  const [address, setAddress] = useState<string>('');
  // Mock user ID for MVP
  const userId = 'user-123';

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [portfolioData, addressData] = await Promise.all([
          walletService.getPortfolio(userId),
          walletService.getAddress(userId)
        ]);
        setPortfolio(portfolioData);
        setAddress(addressData.address);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      }
    };
    fetchData();
  }, [userId]);

  if (!portfolio) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 pb-20">
      {/* Header */}
      <header className="flex justify-between items-center mb-8 pt-4">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="font-bold text-white">X</span>
          </div>
          <span className="font-bold text-lg">Vault</span>
        </div>
        <div className="bg-surface px-3 py-1.5 rounded-full border border-white/10 text-sm font-mono text-secondary">
          {shortenAddress(address)}
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
          {formatCurrency(portfolio.totalBalanceUsd)}
        </div>
        
        <div className="flex justify-center gap-4">
          <Button className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10">
            <ArrowUpRight className="w-5 h-5 text-primary" />
            <span className="text-[10px] text-secondary">Send</span>
          </Button>
          <Button className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10">
            <ArrowDownLeft className="w-5 h-5 text-success" />
            <span className="text-[10px] text-secondary">Receive</span>
          </Button>
          <Button className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10">
            <CreditCard className="w-5 h-5 text-white" />
            <span className="text-[10px] text-secondary">Buy</span>
          </Button>
          <Button className="rounded-full w-14 h-14 p-0 flex flex-col items-center justify-center gap-1 bg-surface border border-white/10 hover:bg-white/10">
            <Plus className="w-5 h-5 text-white" />
            <span className="text-[10px] text-secondary">Add</span>
          </Button>
        </div>
      </motion.div>

      {/* Assets */}
      <div className="space-y-4 mb-8">
        <h3 className="text-lg font-semibold px-1">Assets</h3>
        {portfolio.assets.map((asset: any, index: number) => (
          <motion.div
            key={asset.symbol}
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

      {/* Recent Activity */}
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
                    tx.type === 'receive' ? 'bg-success/20 text-success' : 'bg-white/10 text-white'
                  }`}>
                    {tx.type === 'receive' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
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
                  <div className="text-xs text-secondary capitalize">{tx.status}</div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
