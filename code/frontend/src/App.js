import React, { useState } from 'react';
import Login from './pages/auth/Login';
import Sidebar from './components/Sidebar';
import StoreSelector from './components/StoreSelector';
import Dashboard from './pages/forecast/Dashboard';
import ForecastChart from './pages/forecast/ForecastChart';
import Explanation from './pages/explain/Explanation';
import BusinessPanel from './pages/explain/BusinessPanel';
import ModelCompare from './pages/compare/ModelCompare';
import Agent from './pages/agent/Agent';
import UserManagement from './pages/admin/UserManagement';

export default function App() {
  const [user,          setUser]          = useState(null);
  const [activePage,    setActivePage]    = useState('dashboard');
  const [selectedStore, setSelectedStore] = useState(1);
  const [forecastType,  setForecastType]  = useState('weekly');

  const handleLogin = (userData) => {
    setUser(userData);
    if (userData.role === 'manager' && userData.assigned_store) {
      setSelectedStore(userData.assigned_store);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('token');
    setUser(null);
    setActivePage('dashboard');
  };

  if (!user) return <Login onLogin={handleLogin} />;

  const props = { selectedStore, forecastType, setActivePage };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':   return <Dashboard       {...props} />;
      case 'forecast':    return <ForecastChart   {...props} />;
      case 'explanation': return <Explanation     {...props} />;
      case 'business':    return <BusinessPanel   {...props} />;
      case 'compare':     return <ModelCompare              />;
      case 'agent':       return <Agent           {...props} />;
      case 'users':       return <UserManagement  user={user} />;
      default:            return <Dashboard       {...props} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-transparent lg:flex">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        user={user}
        onLogout={handleLogout}
        forecastType={forecastType}
      />
      <div className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto px-5 py-6">
          <StoreSelector
            selectedStore={selectedStore}
            setSelectedStore={setSelectedStore}
            forecastType={forecastType}
            setForecastType={setForecastType}
            userRole={user?.role}
            assignedStore={user?.assigned_store}
          />
          {renderPage()}
        </div>
      </div>
    </div>
  );
}