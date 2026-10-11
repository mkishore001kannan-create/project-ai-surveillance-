import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./Detect/Login";
import SafetyMonitoringSystem from "./Detect/SafetyMonitoring";
import History from "./Detect/History";

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/safety-monitoring-system" element={<SafetyMonitoringSystem />} />
        <Route path="/history" element={<History />} />
      </Routes>
    </Router>
  );
};

export default App;