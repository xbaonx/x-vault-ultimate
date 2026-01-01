import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowDownLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

export default function Receive() {
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
        <h1 className="text-xl font-bold">Receive Assets</h1>
      </header>

      <div className="max-w-md mx-auto space-y-6">
        <div className="flex justify-center py-10">
          <div className="bg-success/20 p-6 rounded-full">
            <ArrowDownLeft className="w-12 h-12 text-success" />
          </div>
        </div>
        
        <Card className="bg-surface/50 border-white/5">
          <CardContent className="p-6 text-center">
            <h2 className="text-lg font-semibold mb-2 text-white">Feature Coming Soon</h2>
            <p className="text-secondary text-sm">
              Your QR code and wallet address display is currently under development.
              You can view your address on the Dashboard.
            </p>
          </CardContent>
        </Card>

        <Button 
          className="w-full h-12 text-lg font-medium"
          onClick={() => navigate('/dashboard')}
        >
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
