import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./Detect/Login";
import SafetyMonitoringSystem from "./Detect/SafetyMonitoring";
import History from "./Detect/History";
import ThemeProvider from "./ThemeProvider";
import Dashboard from "./Detect/Dashboard";
import { RemoteCameraPublisher } from "./Detect/RemoteCamera";

const App = () => {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/dashboard" element={<ProtectedDashboardRoute />} />
          <Route path="/safety-monitoring-system" element={<ProtectedMonitoringRoute />} />
          <Route path="/recording" element={<ProtectedMonitoringRoute />} />
          <Route path="/history" element={<ProtectedHistoryRoute />} />
          <Route path="/camera-publisher/:cameraId" element={<ProtectedPublisherRoute />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

const ProtectedMonitoringRoute = () => (
  localStorage.getItem("sentinel_token") ? <SafetyMonitoringSystem /> : <Login />
);
const ProtectedDashboardRoute = () => (
  localStorage.getItem("sentinel_token") ? <Dashboard /> : <Login />
);

const ProtectedHistoryRoute = () => (
  localStorage.getItem("sentinel_token") ? <History /> : <Login />
);
const ProtectedPublisherRoute = () => (
  localStorage.getItem("sentinel_token") ? <PublisherRoute /> : <Login />
);
const PublisherRoute = () => {
  const cameraId = window.location.pathname.split('/').pop();
  return <RemoteCameraPublisher cameraId={cameraId} />;
};

export default App;