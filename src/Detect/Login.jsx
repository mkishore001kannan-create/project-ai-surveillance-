import { useState } from "react";
import { useTheme } from "../useTheme";
import "./New.css";
import { apiRequest } from "../utils/api";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(""); // Single password state
  const [error, setError] = useState(""); // State for error message
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { theme, setTheme } = useTheme();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(""); // Clear previous errors
    setIsSubmitting(true);
    try {
      const { token, user } = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: username, password }),
      });
      if (rememberMe) {
        localStorage.setItem("sentinel_token", token);
        localStorage.setItem("sentinel_session", JSON.stringify({ ...user, signedInAt: Date.now() }));
      }
      window.location.assign("/dashboard");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in. Please try again.");
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setUsername(""); // Clear username
    setPassword(""); // Clear password
    setError(""); // Clear error message
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="brand-lockup">
          <div className="brand-mark">✦</div>
          <div>
            <span className="brand-name">SENTINEL</span>
            <span className="brand-caption">AI SAFETY SYSTEMS</span>
          </div>
          <div className="login-theme-row">
            <span>Appearance</span>
            <div className="theme-switcher compact" role="group" aria-label="Appearance mode">
              {["light", "dark", "system"].map((option) => (
                <button key={option} type="button" className={theme === option ? "selected" : ""} onClick={() => setTheme(option)}>
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="login-eyebrow">SECURE OPERATIONS PORTAL</div>
        <h1 className="login-title">Welcome back, operator</h1>
        <p className="login-subtitle">Sign in to access your live safety command center.</p>
        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              name="email"
              type="email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="operator@example.com"
              autoComplete="username"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
            <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          {error && <p className="error-message">{error}</p>}

          <label className="remember-control">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            <span>Keep me signed in on this device</span>
          </label>
          <div className="button-group">
            <button type="submit" className="login-button" disabled={isSubmitting}>
              {isSubmitting ? "Opening command center..." : "Enter command center"} <span>→</span>
            </button>
            <button
              type="button"
              className="cancel-button"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </form>
        <div className="login-security"><span className="security-dot" /> End-to-end encrypted operator session</div>
      </div>
    </div>
  );
};

export default Login;
