import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

export default function Swap() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <header className="flex items-center mb-8 pt-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate('/dashboard')}
          className="mr-2 text-white hover:bg-white/10"
        >
          <ArrowLeft className="w-6 h-6" />
        </Button>
        <h1 className="text-xl font-bold">Swap Assets</h1>
      </header>

      <div className="max-w-md mx-auto space-y-6">
        <div className="flex justify-center py-10">
          <div className="bg-blue-500/20 p-6 rounded-full">
            <RefreshCw className="w-12 h-12 text-blue-500" />
          </div>
        </div>
        
        <Card className="bg-surface/50 border-white/5">
          <CardContent className="p-6 text-center">
            <h2 className="text-lg font-semibold mb-2 text-white">Native Swap Coming Soon</h2>
            <p className="text-secondary text-sm mb-6">
              We are integrating a high-performance DEX aggregator (0x / 1inch) to verify the best rates for your Zaur Card.
            </p>
            <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                <p className="text-xs text-secondary">In the meantime, you can use external swaps like Uniswap or 1inch by connecting via WalletConnect (Coming in v2.0).</p>
            </div>
          </CardContent>
        </Card>

        <Button 
          className="w-full h-12 text-lg font-medium"
          onClick={() => navigate('/dashboard')}
        >
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
