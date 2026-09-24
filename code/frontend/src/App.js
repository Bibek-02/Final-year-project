import React, { useState } from 'react';
import Login from './pages/auth/Login';
import Sidebar from './components/Sidebar';
import StoreSelector from './components/StoreSelector';
import Dashboard from './pages/forecast/Dashboard';
import ForecastChart from './pages/forecast/ForecastChart';
import Explanation from './pages/explain/Explanation';
import ModelCompare from './pages/compare/ModelCompare';
import StoreComparison, { DEFAULT_COMPARISON_FILTERS } from './pages/compare/StoreComparison';
import Agent from './pages/agent/Agent';
import UserManagement from './pages/admin/UserManagement';

export default function App() {
  const [user,               setUser]               = useState(null);
  const [activePage,         setActivePage]         = useState('dashboard');
  const [selectedStore,      setSelectedStore]      = useState(1);
  const [forecastType,       setForecastType]       = useState('weekly');
  const [comparisonFilters,  setComparisonFilters]  = useState(DEFAULT_COMPARISON_FILTERS);
  // One-shot handoff: set by a page just before navigating away so the
  // receiving page can seed its own local period state to match, then
  // cleared by that page once consumed (see each page's mount effect).
  const [handoffPeriod,      setHandoffPeriod]      = useState(null);

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

  const props = { selectedStore, forecastType, setActivePage, handoffPeriod, setHandoffPeriod };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':   return <Dashboard       {...props} />;
      case 'forecast':    return <ForecastChart   {...props} />;
      case 'explanation': return <Explanation     {...props} />;
      // 'business' is a retired page key — redirect any lingering reference to the merged Explanation page.
      case 'business':    return <Explanation     {...props} />;
      case 'compare':     return <ModelCompare              />;
      case 'storeComparison': return (
        <StoreComparison
          forecastType={forecastType}
          setForecastType={setForecastType}
          setSelectedStore={setSelectedStore}
          setActivePage={setActivePage}
          filters={comparisonFilters}
          setFilters={setComparisonFilters}
          user={user}
        />
      );
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
          {activePage !== 'storeComparison' && (
            <StoreSelector
              selectedStore={selectedStore}
              setSelectedStore={setSelectedStore}
              forecastType={forecastType}
              setForecastType={setForecastType}
              userRole={user?.role}
              assignedStore={user?.assigned_store}
            />
          )}
          {renderPage()}
        </div>
      </div>
    </div>
  );
}