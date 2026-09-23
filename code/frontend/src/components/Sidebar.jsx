import React, { useState } from 'react';
import {
  LayoutDashboard, TrendingUp, Search,
  Bot, Scale, Users, Building2, Menu, X, Trophy, ChevronLeft, ChevronRight, LogOut,
  Sun, Moon,
} from 'lucide-react';
import client from '../api/client';
import { useApi } from '../hooks/useApi';
import { useTheme } from '../context/ThemeContext';

// `group` mirrors the thesis's own Forecast -> Explain -> Decide ->
// Evidence -> Admin structure. Same shape used by the previous
// top-navbar's grouping — a vertical grouped list ports directly into a
// sidebar without redesigning it.
const links = [
  { key: 'dashboard',   label: 'Dashboard',               icon: LayoutDashboard, group: 'Overview', adminOnly: false },
  { key: 'forecast',    label: 'Forecast',                icon: TrendingUp,      group: 'Analysis',  adminOnly: false },
  { key: 'explanation', label: 'Explanation',             icon: Search,          group: 'Analysis',  adminOnly: false },
  { key: 'storeComparison', label: 'Store Comparison',    icon: Building2,       group: 'Analysis',  adminOnly: true  },
  { key: 'agent',       label: 'AI Recommendations',      icon: Bot,             group: 'Decide',    adminOnly: false },
  { key: 'compare',     label: 'Models',                  icon: Scale,           group: 'Evidence',  adminOnly: false },
  { key: 'users',       label: 'Users',                   icon: Users,           group: 'Admin',     adminOnly: true  },
];

function Brand({ collapsed }) {
  return (
    <div className={`flex items-center gap-2 py-5 flex-shrink-0 ${
      collapsed ? 'justify-center px-0' : 'px-4'
    }`}>
      <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center
                      justify-center shadow-lg shadow-indigo-900/50 flex-shrink-0">
        <span className="text-white font-black text-sm">R</span>
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-white font-bold text-sm tracking-wide leading-none">
            Rossmann <span className="text-indigo-400">DSS</span>
          </p>
          <p className="text-gray-500 text-[11px] mt-1 truncate">Explainable Demand Forecasting</p>
        </div>
      )}
    </div>
  );
}

// Real data only — GET /models/best, already used by Dashboard/ModelCompare.
// Silently renders nothing while loading/on error rather than an inline
// error banner; it's a supporting widget, not primary content. Kept to one
// compact row rather than a multi-line card — "which model is live" is
// useful context, but not important enough to spend that much sidebar
// height on every page.
function ModelInUseCard({ forecastType }) {
  const { data } = useApi(
    () => client.get(`/models/best?forecast_type=${forecastType}`).then(res => res.data),
    [forecastType],
    'Failed to load model info.'
  );

  if (!data) return null;

  return (
    <div className="mx-3 mb-3 flex-shrink-0 flex items-center gap-2 bg-gray-800/60
                    border border-gray-700 rounded-xl px-3 py-2">
      <Trophy size={13} className="text-indigo-400 flex-shrink-0" />
      <p className="text-xs text-gray-300 truncate">
        <span className="font-semibold text-white">{data.best_model}</span>
        {' '}· {forecastType === 'weekly' ? 'Weekly' : 'Monthly'} · RMSE {Math.round(data.RMSE).toLocaleString('en-US')}
      </p>
    </div>
  );
}

export default function Sidebar({ activePage, setActivePage, user, onLogout, forecastType }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed,  setCollapsed]  = useState(false);
  const { theme, toggleTheme } = useTheme();
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const visibleLinks = links.filter(l => !l.adminOnly || user?.role === 'admin');
  const groups = [...new Set(visibleLinks.map(l => l.group))]
    .map(group => ({ group, items: visibleLinks.filter(l => l.group === group) }));

  const handleNav = (key) => {
    setActivePage(key);
    setDrawerOpen(false);
  };

  // `isCollapsed` only ever applies to the desktop rail — the mobile drawer
  // always renders the full (uncollapsed) version, since it's an overlay
  // with no permanent-space reason to shrink.
  const renderNavList = (isCollapsed) => (
    <nav className="flex-1 overflow-y-auto sidebar-scroll py-4 space-y-4">
      {groups.map(({ group, items }) => (
        <div key={group}>
          {!isCollapsed && (
            <p className="px-4 mb-1.5 text-xs font-medium text-gray-500">
              {group}
            </p>
          )}
          <div className="space-y-0.5 px-2">
            {items.map(link => (
              <button
                key={link.key}
                onClick={() => handleNav(link.key)}
                aria-current={activePage === link.key ? 'page' : undefined}
                title={isCollapsed ? link.label : undefined}
                className={`w-full flex items-center rounded-lg
                            text-sm font-medium transition-all duration-150 ${
                  isCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
                } ${
                  activePage === link.key
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                }`}
              >
                <link.icon size={18} />
                {!isCollapsed && link.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const renderUserFooter = (isCollapsed) => (
    <div className={`border-t border-gray-700 flex items-center flex-shrink-0 ${
      isCollapsed ? 'flex-col gap-2 py-3' : 'justify-between px-4 py-3'
    }`}>
      <div className={`flex items-center gap-2 min-w-0 ${isCollapsed ? 'flex-col' : ''}`}>
        <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center
                        justify-center text-xs font-bold text-white flex-shrink-0">
          {user?.username?.charAt(0).toUpperCase()}
        </div>
        {!isCollapsed && (
          <div className="text-xs min-w-0">
            <p className="text-white font-medium truncate">{user?.username}</p>
            <p className="text-gray-500 capitalize">{user?.role}</p>
          </div>
        )}
      </div>
      <div className={`flex items-center gap-1 ${isCollapsed ? 'flex-col' : ''}`}>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400
                     hover:text-white hover:bg-gray-800 transition-colors flex-shrink-0"
        >
          <ThemeIcon size={14} />
        </button>
        <button
          onClick={onLogout}
          title="Sign out"
          className={`text-gray-400 hover:text-white rounded-lg hover:bg-gray-800
                     transition-colors flex-shrink-0 ${
            isCollapsed ? 'p-1.5' : 'text-xs px-2 py-1.5'
          }`}
        >
          {isCollapsed ? <LogOut size={14} /> : 'Sign out'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — collapses to an icon-only rail rather than fully
          disappearing, so navigation (and a way back to full width) always
          stays reachable without a separate "where did it go" affordance. */}
      <aside className={`hidden lg:flex lg:flex-col ${collapsed ? 'w-[72px]' : 'w-64'}
                        flex-shrink-0 h-screen sticky top-0 bg-gradient-to-b
                        from-gray-900 via-gray-800 to-gray-900 border-r
                        border-gray-700 transition-all duration-200`}>
        {/* Top row: logo + inline collapse toggle (expanded) or stacked
            (collapsed) — matches the reference's icons-beside-title layout
            rather than a floating edge button. */}
        <div className={`flex items-center flex-shrink-0 ${
          collapsed ? 'flex-col gap-1 pt-4 pb-1' : 'justify-between pl-1 pr-2'
        }`}>
          <Brand collapsed={collapsed} />
          <button
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-7 h-7 flex items-center justify-center rounded-lg
                       text-gray-400 hover:text-white hover:bg-gray-800/60
                       transition-colors flex-shrink-0"
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>
        {renderNavList(collapsed)}
        {!collapsed && <ModelInUseCard forecastType={forecastType} />}
        {renderUserFooter(collapsed)}
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between
                      px-4 h-14 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900
                      border-b border-gray-700 shadow-xl">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-black text-xs">R</span>
          </div>
          <span className="text-white font-bold text-sm">Rossmann DSS</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center
                          justify-center text-xs font-bold text-white">
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            className="text-gray-300 hover:text-white p-2 rounded-lg
                       hover:bg-gray-700 transition-colors"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Mobile drawer — conditionally rendered (not just visually hidden) so
          off-screen links are never focusable/in the a11y tree while closed. */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-gray-900/70 animate-fadeIn"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-[80vw] h-full flex flex-col
                          bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900
                          shadow-2xl animate-fadeIn">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-3 top-4 text-gray-300 hover:text-white
                         p-1.5 rounded-lg hover:bg-gray-700 transition-colors"
            >
              <X size={20} />
            </button>
            <Brand />
            {renderNavList(false)}
            <ModelInUseCard forecastType={forecastType} />
            {renderUserFooter(false)}
          </div>
        </div>
      )}
    </>
  );
}
