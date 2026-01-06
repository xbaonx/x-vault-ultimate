import { useState, useEffect } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import { Users, CreditCard, Activity, DollarSign, Settings, Bell, Key } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { adminApi, type AppleConfigStatus, type DashboardStats, type UserData, type TransactionData, type UserDetailData } from '../services/api';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  // Global Admin Key - Input State
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('admin_key') || '');
  // Session Key - The actual key used for requests (only updates on Connect/Enter)
  const [sessionKey, setSessionKey] = useState(() => localStorage.getItem('admin_key') || '');

  // Dashboard Data
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [usersList, setUsersList] = useState<UserData[]>([]);
  const [transactionsList, setTransactionsList] = useState<TransactionData[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetailData | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [userDetailError, setUserDetailError] = useState<string | null>(null);

  // Apple Config State
  const [teamId, setTeamId] = useState('');
  const [passTypeIdentifier, setPassTypeIdentifier] = useState('');
  const [signerKeyPassphrase, setSignerKeyPassphrase] = useState('');
  const [wwdr, setWwdr] = useState<File | null>(null);
  const [signerP12, setSignerP12] = useState<File | null>(null);

  const [appleStatus, setAppleStatus] = useState<AppleConfigStatus | null>(null);
  const [loadingApple, setLoadingApple] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);
  const [appleSuccess, setAppleSuccess] = useState<string | null>(null);
  const [testPassResult, setTestPassResult] = useState<{ success: boolean; message: string } | null>(null);

  const normalizeApiUrl = (url: string | undefined) => {
    if (!url) return 'http://localhost:3000';
    if (url.startsWith('http')) return url;
    if (url.includes('localhost')) return `http://${url}`;
    if (!url.includes('.')) return `https://${url}.onrender.com`;
    return `https://${url}`;
  };

  const envApiUrl = import.meta.env.VITE_API_URL;
  const apiOrigin = normalizeApiUrl(envApiUrl);

  // Effect to load data when tab changes, ONLY if we have a valid session key
  useEffect(() => {
    if (!sessionKey) return;
    fetchData(sessionKey);
  }, [activeTab]);

  // Initial load if key exists in storage
  useEffect(() => {
    if (sessionKey) {
        fetchData(sessionKey);
    }
  }, []);

  const handleConnect = () => {
    if (!adminKey) return;
    setSessionKey(adminKey);
    localStorage.setItem('admin_key', adminKey);
    fetchData(adminKey);
  };

  const fetchData = async (key: string) => {
    setLoadingData(true);
    setDataError(null);
    try {
      if (activeTab === 'overview') {
        const stats = await adminApi.getDashboardStats(key);
        setDashboardStats(stats);
      } else if (activeTab === 'users') {
        const users = await adminApi.getUsers(key);
        setUsersList(users);
      } else if (activeTab === 'transactions') {
        const txs = await adminApi.getTransactions(key);
        setTransactionsList(txs);
      } else if (activeTab === 'settings') {
        loadAppleConfig(key);
      }
    } catch (err: any) {
      console.error(err);
      if (activeTab !== 'settings') { // Settings load handled separately
        setDataError(err.message || 'Failed to load data. Check Admin Key.');
      }
    } finally {
      setLoadingData(false);
    }
  };

  const loadAppleConfig = async (key: string = sessionKey) => {
    try {
      setAppleError(null);
      setAppleSuccess(null);
      setLoadingApple(true);
      const data = await adminApi.getAppleConfig(key);
      setAppleStatus(data);
      if (data.teamId) setTeamId(data.teamId);
      if (data.passTypeIdentifier) setPassTypeIdentifier(data.passTypeIdentifier);
    } catch (e: any) {
      setAppleError(e?.message || 'Failed to load Apple config');
    } finally {
      setLoadingApple(false);
    }
  };

  const uploadApple = async () => {
    try {
      setAppleError(null);
      setAppleSuccess(null);
      setLoadingApple(true);
      await adminApi.uploadAppleCerts({
        adminKey: sessionKey,
        teamId,
        passTypeIdentifier,
        signerKeyPassphrase,
        wwdr,
        signerP12,
      });
      setAppleSuccess('Saved');
      setWwdr(null);
      setSignerP12(null);
      await loadAppleConfig(sessionKey);
    } catch (e: any) {
      setAppleError(e?.message || 'Upload failed');
    } finally {
      setLoadingApple(false);
    }
  };

  const handleFreeze = async (userId: string) => {
    if (!confirm('Are you sure you want to FREEZE this user? They will lose access immediately.')) return;
    try {
        await adminApi.freezeUser(sessionKey, userId);
        // Refresh
        fetchData(sessionKey);
    } catch (err: any) {
        alert(err.message || 'Failed to freeze user');
    }
  };

  const handleUnfreeze = async (userId: string) => {
    if (!confirm('Unfreeze this user?')) return;
    try {
        await adminApi.unfreezeUser(sessionKey, userId);
        // Refresh
        fetchData(sessionKey);
    } catch (err: any) {
        alert(err.message || 'Failed to unfreeze user');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Delete this user permanently? This cannot be undone.')) return;
    try {
      await adminApi.deleteUser(sessionKey, userId);
      fetchData(sessionKey);
    } catch (err: any) {
      alert(err.message || 'Failed to delete user');
    }
  };

  const handleViewUser = async (userId: string) => {
    if (!sessionKey) return;

    if (selectedUserId === userId) {
      setSelectedUserId(null);
      setUserDetail(null);
      setUserDetailError(null);
      return;
    }

    setSelectedUserId(userId);
    setUserDetail(null);
    setUserDetailError(null);
    setUserDetailLoading(true);
    try {
      const detail = await adminApi.getUserDetail(sessionKey, userId);
      setUserDetail(detail);
    } catch (err: any) {
      setUserDetailError(err.message || 'Failed to load user detail');
    } finally {
      setUserDetailLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-surface p-6 hidden md:flex flex-col">
        <div className="flex items-center space-x-2 mb-10">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="font-bold text-white">Z</span>
          </div>
          <span className="font-bold text-xl">Zaur Admin</span>
        </div>
        
        <div className="mb-6">
            <label className="text-xs text-secondary mb-2 block flex items-center gap-1">
                <Key className="w-3 h-3" /> Admin Key
            </label>
            <form onSubmit={(e) => { e.preventDefault(); handleConnect(); }} className="flex gap-2">
                <Input 
                    type="password" 
                    value={adminKey} 
                    onChange={(e) => setAdminKey(e.target.value)}
                    placeholder="Enter key..."
                    className="h-8 text-xs flex-1"
                    autoComplete="current-password"
                />
                <Button type="submit" size="sm" className="h-8 px-2">
                    <Activity className="w-3 h-3" />
                </Button>
            </form>
        </div>

        <nav className="space-y-2 flex-1">
          <Button 
            variant={activeTab === 'overview' ? 'secondary' : 'ghost'} 
            className="w-full justify-start"
            onClick={() => setActiveTab('overview')}
          >
            <Activity className="mr-2 h-4 w-4" />
            Overview
          </Button>
          <Button 
            variant={activeTab === 'users' ? 'secondary' : 'ghost'} 
            className="w-full justify-start"
            onClick={() => setActiveTab('users')}
          >
            <Users className="mr-2 h-4 w-4" />
            Users
          </Button>
          <Button 
            variant={activeTab === 'transactions' ? 'secondary' : 'ghost'} 
            className="w-full justify-start"
            onClick={() => setActiveTab('transactions')}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Transactions
          </Button>
          <Button 
            variant={activeTab === 'settings' ? 'secondary' : 'ghost'} 
            className="w-full justify-start"
            onClick={() => setActiveTab('settings')}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">
            {activeTab === 'overview' && 'Dashboard Overview'}
            {activeTab === 'users' && 'Users'}
            {activeTab === 'transactions' && 'Transactions'}
            {activeTab === 'settings' && 'Settings'}
          </h1>
          <Button variant="outline" size="icon">
            <Bell className="h-4 w-4" />
          </Button>
        </div>

        {!adminKey && (
             <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 p-4 rounded-lg mb-6">
                Please enter the Admin Key in the sidebar to load data.
             </div>
        )}

        {/* Debug Info */}
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 p-4 rounded-lg mb-6 text-xs font-mono">
            <div><strong>DEBUG INFO:</strong></div>
            <div>API URL: {apiOrigin}</div>
            <div>Admin Key Length: {adminKey.length} chars</div>
            <div>Status: {loadingData ? 'Loading...' : 'Ready'}</div>
        </div>

        {dataError && (
             <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-lg mb-6">
                {dataError}
             </div>
        )}

        {activeTab === 'overview' && dashboardStats && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-secondary">
                    Total Users
                  </CardTitle>
                  <Users className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{dashboardStats.stats.totalUsers}</div>
                  <p className="text-xs text-success flex items-center mt-1">
                    Registered users
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-secondary">
                    Total Transactions
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-success" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{dashboardStats.stats.totalVolume}</div>
                  <p className="text-xs text-success flex items-center mt-1">
                    Processed
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-secondary">
                    Active Sessions
                  </CardTitle>
                  <Activity className="h-4 w-4 text-warning" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{dashboardStats.stats.activeSessions}</div>
                  <p className="text-xs text-secondary flex items-center mt-1">
                    Estimated
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-secondary">
                    Gas Sponsored
                  </CardTitle>
                  <CreditCard className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{dashboardStats.stats.gasSponsored}</div>
                  <p className="text-xs text-secondary flex items-center mt-1">
                    Via Paymaster
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <Card className="col-span-1">
                <CardHeader>
                  <CardTitle>User Growth</CardTitle>
                  <CardDescription>New user registrations over time</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dashboardStats.userGrowthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="name" stroke="#888" />
                      <YAxis stroke="#888" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1C1C1E', border: '1px solid #333' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Line type="monotone" dataKey="users" stroke="#0A84FF" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card className="col-span-1">
                <CardHeader>
                  <CardTitle>Transaction Volume</CardTitle>
                  <CardDescription>Daily transaction volume in USD</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboardStats.transactionVolumeData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="name" stroke="#888" />
                      <YAxis stroke="#888" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1C1C1E', border: '1px solid #333' }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value: number) => [`${value}`, 'Volume']}
                      />
                      <Bar dataKey="volume" fill="#30D158" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent Registrations</CardTitle>
                <CardDescription>Latest users joined via device binding</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {dashboardStats.recentUsers.map((user) => (
                    <div key={user.id} className="flex items-center justify-between border-b border-white/5 pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 rounded-full bg-surface border border-white/10 flex items-center justify-center">
                          <Users className="w-5 h-5 text-secondary" />
                        </div>
                        <div>
                          <p className="font-medium text-white">{user.address}</p>
                          <p className="text-xs text-secondary">{new Date(user.joined).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className={`px-2 py-1 rounded-full text-xs ${
                        user.status === 'Active' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
                      }`}>
                        {user.status}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === 'users' && (
          <Card>
            <CardHeader>
              <CardTitle>All Users</CardTitle>
              <CardDescription>Latest 50 users</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {usersList.map((user) => (
                  <div key={user.id} className="border-b border-white/5 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-white">{user.address}</p>
                        <p className="text-xs text-secondary">Joined: {new Date(user.createdAt).toLocaleString()}</p>
                        <p className="text-xs text-secondary/50">ID: {user.id}</p>
                      </div>
                      <div className="flex items-center gap-3">
                          <div className={`px-2 py-1 rounded-full text-xs ${
                              user.isFrozen ? 'bg-destructive/20 text-destructive' : 'bg-success/20 text-success'
                          }`}>
                              {user.isFrozen ? 'FROZEN' : 'Active'}
                          </div>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleViewUser(user.id)}>
                              {selectedUserId === user.id ? 'Hide' : 'View'}
                          </Button>
                          {user.isFrozen ? (
                              <Button size="sm" variant="outline" className="h-7 text-xs border-success/50 text-success hover:text-success" onClick={() => handleUnfreeze(user.id)}>
                                  Unfreeze
                              </Button>
                          ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/50 text-destructive hover:text-destructive" onClick={() => handleFreeze(user.id)}>
                                  Freeze
                              </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/50 text-destructive hover:text-destructive" onClick={() => handleDeleteUser(user.id)}>
                              Delete
                          </Button>
                      </div>
                    </div>

                    {selectedUserId === user.id && (
                      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
                        {userDetailLoading && (
                          <div className="text-sm text-secondary">Loading user detail...</div>
                        )}
                        {userDetailError && (
                          <div className="text-sm text-destructive">{userDetailError}</div>
                        )}
                        {userDetail && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="text-xs text-secondary">
                                <div className="text-white font-medium">User</div>
                                <div>ID: <span className="text-white/80">{userDetail.user.id}</span></div>
                                <div>Email: <span className="text-white/80">{userDetail.user.email || '-'}</span></div>
                                <div>AppleUserId: <span className="text-white/80">{userDetail.user.appleUserId || '-'}</span></div>
                                <div>Frozen: <span className="text-white/80">{String(!!userDetail.user.isFrozen)}</span></div>
                                <div>Has PIN: <span className="text-white/80">{String(!!userDetail.user.hasPin)}</span></div>
                                <div>Limit (USD): <span className="text-white/80">{String(userDetail.user.spendingLimitUsd ?? '-')}</span></div>
                                <div>USDZ: <span className="text-white/80">{String(userDetail.user.usdzBalance ?? '-')}</span></div>
                              </div>
                              <div className="text-xs text-secondary">
                                <div className="text-white font-medium">Counts</div>
                                <div>Wallets: <span className="text-white/80">{userDetail.wallets.length}</span></div>
                                <div>Devices: <span className="text-white/80">{userDetail.devices.length}</span></div>
                                <div>Pass Registrations: <span className="text-white/80">{userDetail.passRegistrations.length}</span></div>
                                <div>Recent TXs: <span className="text-white/80">{userDetail.recentTransactions.length}</span></div>
                              </div>
                            </div>

                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => navigator.clipboard.writeText(JSON.stringify(userDetail, null, 2))}
                              >
                                Copy JSON
                              </Button>
                            </div>

                            <pre className="text-[11px] leading-relaxed overflow-auto max-h-80 rounded-lg bg-black/40 border border-white/10 p-3 text-white/80">
{JSON.stringify(userDetail, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {usersList.length === 0 && !loadingData && <p className="text-secondary text-sm">No users found.</p>}
            </CardContent>
          </Card>
        )}

        {activeTab === 'transactions' && (
           <Card>
           <CardHeader>
             <CardTitle>Recent Transactions</CardTitle>
             <CardDescription>Latest 50 transactions</CardDescription>
           </CardHeader>
           <CardContent>
             <div className="space-y-4">
               {transactionsList.map((tx) => (
                 <div key={tx.id} className="flex items-center justify-between border-b border-white/5 pb-4 last:border-0 last:pb-0">
                   <div>
                     <p className="font-medium text-white text-xs font-mono">{tx.userOpHash.slice(0, 20)}...</p>
                     <p className="text-xs text-secondary">
                        Network: {tx.network} • {new Date(tx.createdAt).toLocaleString()}
                     </p>
                     <p className="text-xs text-secondary/50">User: {tx.userAddress}</p>
                   </div>
                   <div className={`px-2 py-1 rounded-full text-xs ${
                       tx.status === 'success' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
                   }`}>
                     {tx.status}
                   </div>
                 </div>
               ))}
               {transactionsList.length === 0 && !loadingData && <p className="text-secondary text-sm">No transactions found.</p>}
             </div>
           </CardContent>
         </Card>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Backend Connection</CardTitle>
                <CardDescription>VITE_API_URL</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-secondary">{apiOrigin}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Apple Wallet Certificates</CardTitle>
                <CardDescription>Upload WWDR / Signer Cert / Signer Key</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={(e) => e.preventDefault()} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Admin Key input moved to sidebar */}
                  <div className="md:col-span-2 flex items-center gap-2 mb-4 p-4 border border-white/10 rounded-lg bg-white/5">
                    <Key className="w-4 h-4 text-primary" />
                    <span className="text-sm text-secondary">
                        Using Admin Key from sidebar. 
                        {adminKey ? <span className="text-success ml-2">Key present</span> : <span className="text-warning ml-2">Key missing</span>}
                    </span>
                  </div>

                  <div>
                    <div className="text-sm text-secondary mb-2">Apple Team ID</div>
                    <Input 
                        value={teamId} 
                        onChange={(e) => setTeamId(e.target.value)} 
                        placeholder="TEAMID1234" 
                        autoComplete="off"
                    />
                  </div>
                  <div>
                    <div className="text-sm text-secondary mb-2">Pass Type Identifier</div>
                    <Input 
                        value={passTypeIdentifier} 
                        onChange={(e) => setPassTypeIdentifier(e.target.value)} 
                        placeholder="pass.at.zaur.wallet" 
                        autoComplete="off"
                    />
                  </div>

                  <div>
                    <div className="text-sm text-secondary mb-2">P12 Password</div>
                    <Input 
                      type="password" 
                      autoComplete="new-password"
                      value={signerKeyPassphrase} 
                      onChange={(e) => setSignerKeyPassphrase(e.target.value)} 
                      placeholder="Password used to export .p12" 
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="flex gap-2 w-full">
                        <Button variant="secondary" onClick={() => loadAppleConfig()} disabled={!adminKey || loadingApple} className="flex-1">
                        Load Config
                        </Button>
                        <Button onClick={uploadApple} disabled={!adminKey || loadingApple} className="flex-1">
                        Save Config & Certs
                        </Button>
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <Button 
                        variant="outline" 
                        className="w-full border-primary/50 text-primary hover:bg-primary/10"
                        onClick={async () => {
                            try {
                                setTestPassResult(null);
                                setLoadingApple(true);
                                const response = await fetch(`${apiOrigin}/api/admin/apple/test-pass`, {
                                    headers: { 'x-admin-key': sessionKey }
                                });
                                
                                if (!response.ok) {
                                    const err = await response.json();
                                    throw new Error(err.error || 'Failed to generate test pass');
                                }
                                
                                const blob = await response.blob();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'test.pkpass';
                                document.body.appendChild(a);
                                a.click();
                                window.URL.revokeObjectURL(url);
                                document.body.removeChild(a);
                                setTestPassResult({ success: true, message: "Success! 'test.pkpass' downloaded. Check your Downloads folder." });
                            } catch (e: any) {
                                setTestPassResult({ success: false, message: e.message });
                            } finally {
                                setLoadingApple(false);
                            }
                        }}
                        disabled={!appleStatus?.configured || loadingApple}
                    >
                        {loadingApple ? 'Generating...' : 'Test Configuration (Generate Pass)'}
                    </Button>
                    
                    {testPassResult && (
                        <div className={`mt-2 p-3 rounded text-xs border ${
                            testPassResult.success 
                                ? 'bg-success/10 border-success/20 text-success' 
                                : 'bg-red-500/10 border-red-500/20 text-red-400'
                        }`}>
                            <strong>{testPassResult.success ? '✓ Test Passed' : '✕ Test Failed'}:</strong> {testPassResult.message}
                        </div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm text-secondary mb-2">WWDR Certificate (.cer or .pem)</div>
                    <Input type="file" onChange={(e) => setWwdr(e.target.files?.[0] || null)} />
                    <p className="text-[10px] text-secondary mt-1">Upload AppleWWDRCAG4.cer directly</p>
                  </div>

                  <div className="md:col-span-2 border-t border-white/10 my-2 pt-4">
                    <div className="text-sm font-bold text-white mb-4">Certificate Upload</div>
                    
                    <div className="bg-surface/50 p-4 rounded-lg border border-white/5 mb-4">
                        <div className="text-sm font-semibold text-primary mb-2">Pass Certificate (.p12)</div>
                        <div className="text-xs text-secondary mb-2">
                            Export your certificate and private key together as a .p12 file from Keychain Access.
                        </div>
                        <Input type="file" accept=".p12" onChange={(e) => setSignerP12(e.target.files?.[0] || null)} />
                        <p className="text-[10px] text-yellow-500/80 mt-2">
                          * Tip: If upload fails, re-export from Keychain with a simple password (e.g. "123"). 
                          Some "no password" formats are not supported.
                        </p>
                    </div>
                  </div>
                  
                  {/* Remove old separate inputs to avoid duplication */}
                </form>

                {(appleError || appleSuccess) && (
                  <div className="mt-4">
                    {appleError && <div className="text-sm text-red-400">{appleError}</div>}
                    {appleSuccess && <div className="text-sm text-green-400">{appleSuccess}</div>}
                  </div>
                )}

                {appleStatus && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-secondary border-t border-white/10 pt-4">
                    <div>Configured: <span className={appleStatus.configured ? 'text-success' : 'text-secondary'}>{String(appleStatus.configured)}</span></div>
                    <div>Has WWDR: <span className={appleStatus.hasWwdr ? 'text-success' : 'text-secondary'}>{String(appleStatus.hasWwdr)}</span></div>
                    <div>Has Signer Cert: <span className={appleStatus.hasSignerCert ? 'text-success' : 'text-secondary'}>{String(appleStatus.hasSignerCert)}</span></div>
                    <div>Has Signer Key: <span className={appleStatus.hasSignerKey ? 'text-success' : 'text-secondary'}>{String(appleStatus.hasSignerKey)}</span></div>
                    {appleStatus.updatedAt && <div className="col-span-2 text-xs mt-2">Last updated: {new Date(appleStatus.updatedAt).toLocaleString()}</div>}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
