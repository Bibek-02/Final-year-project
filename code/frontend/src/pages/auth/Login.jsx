import React, { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Lock, TrendingUp, Search, Lightbulb } from 'lucide-react';
import client from '../../api/client';
import AuthBackdrop from '../../components/AuthBackdrop';

const STEPS = [
  { Icon: TrendingUp, title: 'Forecast',  desc: 'Precomputed weekly and monthly sales predictions' },
  { Icon: Search,     title: 'Explain',   desc: 'Local and global SHAP-based explanations' },
  { Icon: Lightbulb,  title: 'Recommend', desc: 'AI-generated stock, staffing and promotion guidance' },
];

const ICON_WRAP = 'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#5B5CEB]/15 text-[#8EA8FF]';

function Wordmark({ tileSize = 'h-11 w-11', textSize = 'text-2xl' }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex ${tileSize} flex-shrink-0 items-center justify-center rounded-2xl
                      bg-[#5B5CEB] shadow-lg shadow-[#5B5CEB]/30`}>
        <span className="font-black text-white">R</span>
      </div>
      <p className={`${textSize} font-black tracking-tight text-white`}>
        Rossmann <span className="text-[#8EA8FF]">DSS</span>
      </p>
    </div>
  );
}

function CapabilityList({ variant = 'full' }) {
  return (
    <div className="space-y-3.5">
      {STEPS.map(({ Icon, title, desc }) => (
        <div key={title} className="flex items-start gap-3">
          <div className={ICON_WRAP}>
            <Icon size={18} strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            {variant === 'full' && (
              <p className="mt-0.5 text-xs text-[#A8B3C7]">{desc}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ThesisLabel() {
  return (
    <p className="text-xs font-medium tracking-wide text-[#8EA8FF]">
      BSc Computer Science Final Year Project
    </p>
  );
}

function ProductIntro() {
  return (
    <div className="hidden max-w-xl lg:flex lg:flex-col lg:justify-center">
      <Wordmark />
      <h1 className="mt-5 text-3xl font-black leading-[1.15] tracking-tight text-white xl:text-4xl">
        Explainable retail forecasting, from evidence to action.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[#A8B3C7] xl:text-base">
        Explore weekly and monthly XGBoost forecasts, understand predictions through
        SHAP explanations, and generate evidence-based retail recommendations.
      </p>
      <div className="mt-6">
        <CapabilityList variant="full" />
      </div>
      <div className="mt-6">
        <ThesisLabel />
      </div>
    </div>
  );
}

export default function Login({ onLogin }) {
  const [username,      setUsername]      = useState('');
  const [password,      setPassword]      = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [serverError,   setServerError]   = useState('');
  const [loading,       setLoading]       = useState(false);
  const [showPass,      setShowPass]      = useState(false);

  const handleUsernameChange = (e) => {
    setUsername(e.target.value);
    if (usernameError) setUsernameError('');
    if (serverError) setServerError('');
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
    if (passwordError) setPasswordError('');
    if (serverError) setServerError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    const nextUsernameError = username ? '' : 'Username is required.';
    const nextPasswordError = password ? '' : 'Password is required.';
    setUsernameError(nextUsernameError);
    setPasswordError(nextPasswordError);
    setServerError('');
    if (nextUsernameError || nextPasswordError) return;

    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      const res = await client.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      sessionStorage.setItem('token', res.data.access_token);
      setPassword('');
      onLogin({
        token         : res.data.access_token,
        username      : res.data.username,
        role          : res.data.role,
        assigned_store: res.data.assigned_store,
      });
    } catch (err) {
      setServerError(err.response?.data?.detail || 'Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  const fieldClass = (hasError) => `h-[52px] w-full rounded-xl border bg-[#0F172A] px-4 text-sm
    text-white placeholder-slate-500 transition-colors focus:outline-none focus:ring-2
    focus:ring-[#5B5CEB] focus:ring-offset-2 focus:ring-offset-[#172235] ${
    hasError ? 'border-red-500/60' : 'border-white/10 hover:border-white/20'
  }`;

  return (
    <main className="relative min-h-screen min-h-[100dvh] overflow-x-hidden bg-[#0B1220]">
      <AuthBackdrop />

      <div className="relative z-10 mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-7xl
                      flex-col items-center justify-center gap-8 px-4 py-8 sm:gap-10 sm:px-6 sm:py-12
                      lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]
                      lg:items-center lg:gap-10 lg:px-10 lg:py-10 xl:gap-16 xl:px-16">

        <ProductIntro />

        {/* Compact intro — mobile & tablet only */}
        <div className="flex w-full max-w-md flex-col items-center text-center
                        sm:max-w-lg lg:hidden">
          <Wordmark tileSize="h-14 w-14" textSize="text-3xl" />
          <h1 className="mt-5 text-2xl font-black leading-tight tracking-tight text-white sm:text-3xl">
            Explainable retail forecasting, from evidence to action.
          </h1>
        </div>

        {/* Login card */}
        <div className="w-full max-w-[480px] rounded-2xl border border-white/10
                        bg-[#172235] p-6 shadow-2xl shadow-black/40 sm:p-8
                        lg:justify-self-end 2xl:max-w-[440px]">
          <h2 className="text-xl font-bold text-white">Sign in to Rossmann DSS</h2>
          <p className="mt-1 text-sm text-[#A8B3C7]">
            Access the forecasting and recommendation dashboard.
          </p>

          {serverError && (
            <div
              role="alert"
              aria-live="polite"
              className="mt-5 flex items-start gap-2 rounded-xl border border-red-800/40
                        bg-red-950/40 px-4 py-3 text-sm text-red-300"
            >
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-6">
            <div className="space-y-5">
              <div>
                <label htmlFor="username" className="mb-1.5 block text-xs font-medium text-[#A8B3C7]">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={handleUsernameChange}
                  placeholder="Enter your username"
                  autoComplete="username"
                  aria-invalid={!!usernameError}
                  aria-describedby={usernameError ? 'username-error' : undefined}
                  className={fieldClass(!!usernameError)}
                />
                {usernameError && (
                  <p id="username-error" className="mt-1.5 text-xs text-red-300">
                    {usernameError}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-[#A8B3C7]">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={handlePasswordChange}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    aria-invalid={!!passwordError}
                    aria-describedby={passwordError ? 'password-error' : undefined}
                    className={`${fieldClass(!!passwordError)} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2
                              items-center justify-center rounded-lg text-slate-400
                              transition-colors hover:text-white focus:outline-none
                              focus:ring-2 focus:ring-[#5B5CEB]"
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {passwordError && (
                  <p id="password-error" className="mt-1.5 text-xs text-red-300">
                    {passwordError}
                  </p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 flex h-[52px] w-full items-center justify-center gap-2
                        rounded-xl bg-[#5B5CEB] text-sm font-semibold text-white
                        transition-colors hover:bg-[#4A4BD1] focus:outline-none
                        focus:ring-2 focus:ring-[#8EA8FF] focus:ring-offset-2
                        focus:ring-offset-[#172235] disabled:cursor-not-allowed
                        disabled:opacity-60"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2
                                   border-white/30 border-t-white" />
                  Signing in…
                </>
              ) : 'Open dashboard'}
            </button>
          </form>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-[#8792A8]">
            <Lock size={12} className="flex-shrink-0" />
            Authorised thesis demonstration access only
          </p>
        </div>

        {/* Capabilities — mobile & tablet only */}
        <div className="w-full max-w-md sm:max-w-lg lg:hidden">
          <CapabilityList variant="full" />
        </div>

        {/* Thesis label — mobile & tablet only */}
        <div className="text-center lg:hidden">
          <ThesisLabel />
        </div>
      </div>
    </main>
  );
}
