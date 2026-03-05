import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = username.trim();
    if (!trimmed || !password) {
      setError('Please enter username and password.');
      return;
    }
    if (!login(trimmed, password)) {
      setError('Invalid username or password.');
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo">◇</span>
          <h1 className="login-title">Scheduler</h1>
          <p className="login-subtitle">Sign in to continue</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          {error && <p className="login-error" role="alert">{error}</p>}
          <label className="login-label">
            Username
            <input
              type="text"
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="login-label">
            Password
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="login-submit">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
