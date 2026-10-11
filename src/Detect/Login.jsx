import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./New.css";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(""); // Single password state
  const [error, setError] = useState(""); // State for error message
  const navigate = useNavigate();

  // List of valid passwords
  const validPasswords = ["123456789", "987654321"];

  const handleLogin = (e) => {
    e.preventDefault();
    setError(""); // Clear previous errors

    // Check if username and password are valid
    if (username === "admin" && validPasswords.includes(password)) {
      navigate("/safety-monitoring-system");
    } else {
      setError("Invalid username or password!"); // Set error message
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
        <h1 className="login-title">Welcome Back</h1>
        <p className="login-subtitle">Login to access your account</p>
        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          {/* Display error message if any */}
          {error && <p className="error-message">{error}</p>}

          <div className="button-group">
            <button type="submit" className="login-button">
              Login
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
      </div>
    </div>
  );
};

export default Login;
