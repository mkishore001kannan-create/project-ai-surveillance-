import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllIncidents } from '../utils/db';
import { apiRequest } from '../utils/api';
import { useTheme } from '../useTheme';
import './New.css';

const Dashboard = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [incidents, setIncidents] = useState([]);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'operator' });
  const [userError, setUserError] = useState('');
  const [cameras, setCameras] = useState([]);
  const [cameraError, setCameraError] = useState('');
  const [newCamera, setNewCamera] = useState({ name: '', streamUrl: '', location: '', description: '', sourceType: 'publisher' });
  const session = JSON.parse(localStorage.getItem('sentinel_session') || '{}');
  const sessionRole = session.role;

  useEffect(() => {
    getAllIncidents().then(setIncidents).catch((error) => console.error('Failed to load dashboard incidents:', error));
    if (sessionRole === 'admin') apiRequest('/api/users').then(({ users: availableUsers }) => setUsers(availableUsers)).catch((error) => setUserError(error.message));
    apiRequest('/api/cameras').then(({ cameras: availableCameras }) => setCameras(availableCameras)).catch((error) => setCameraError(error.message));
  }, [sessionRole]);

  const createUser = async (event) => {
    event.preventDefault();
    setUserError('');
    try {
      const { id, email, role } = await apiRequest('/api/users', { method: 'POST', body: JSON.stringify(newUser) });
      setUsers((current) => [{ id, email, role, active: 1 }, ...current]);
      setNewUser({ email: '', password: '', role: 'operator' });
    } catch (error) {
      setUserError(error.message);
    }
  };

  const registerCamera = async (event) => {
    event.preventDefault();
    setCameraError('');
    try {
      const { camera } = await apiRequest('/api/cameras', { method: 'POST', body: JSON.stringify(newCamera) });
      setCameras((current) => [camera, ...current]);
      setNewCamera({ name: '', streamUrl: '', location: '', description: '', sourceType: 'publisher' });
    } catch (error) {
      setCameraError(error.message);
    }
  };

  const removeCamera = async (camera) => {
    if (!window.confirm(`Remove ${camera.name}?`)) return;
    try {
      await apiRequest(`/api/cameras/${camera.id}`, { method: 'DELETE' });
      setCameras((current) => current.filter((item) => item.id !== camera.id));
    } catch (error) {
      setCameraError(error.message);
    }
  };

  const incidentTypes = [...new Set(incidents.map((incident) => incident.type))];
  return (
    <div className="safety-monitoring-container dashboard-page">
      <div className="monitoring-wrapper">
        <header className="monitoring-header">
          <div className="header-content">
            <div className="system-heading"><div className="system-brand-mark">✦</div><div><p className="system-kicker">SENTINEL / OPERATIONS</p><h1 className="system-title">Command dashboard</h1></div></div>
            <div className="header-actions">
              <div className="theme-switcher" role="group" aria-label="Appearance mode">
                {['light', 'dark', 'system'].map((option) => <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => setTheme(option)}>{option}</button>)}
              </div>
              <button onClick={() => navigate('/recording')} className="test-btn primary-action">● Open recording</button>
              <button onClick={() => { localStorage.removeItem('sentinel_session'); localStorage.removeItem('sentinel_token'); navigate('/'); }} className="test-btn">Sign out</button>
            </div>
          </div>
        </header>
        <section className="hero-strip">
          <div><p className="hero-eyebrow"><span className="live-pulse" /> COMMAND OVERVIEW / LIVE</p><h2>See everything. <span>Respond faster.</span></h2><p className="hero-copy">Your operational snapshot across cameras, detections, and incident response.</p></div>
          <div className="hero-status"><strong>SECURE</strong><span>Platform status</span><i /></div>
        </section>
        <section className="command-summary" aria-label="Dashboard overview">
          <div className="summary-card"><span className="summary-icon">◈</span><div><small>TOTAL INCIDENTS</small><strong>{incidents.length}</strong><em className="up">Last 10 days</em></div></div>
          <div className="summary-card"><span className="summary-icon cyan">◉</span><div><small>INCIDENT CATEGORIES</small><strong>{incidentTypes.length}</strong><em>AI classifications</em></div></div>
          <div className="summary-card"><span className="summary-icon amber">◷</span><div><small>RETENTION WINDOW</small><strong>10 days</strong><em>Automatic cleanup</em></div></div>
          <div className="summary-card"><span className="summary-icon green">✓</span><div><small>ALERT CHANNEL</small><strong>Telegram</strong><em className="up">Configured</em></div></div>
        </section>
        <div className="dashboard-grid">
          <section className="dashboard-card dashboard-welcome"><p className="section-kicker">QUICK ACTIONS</p><h3>Start a new monitoring session</h3><p>Open the dedicated recording workspace to connect a camera, run AI inference, and capture incidents automatically.</p><button className="login-button" onClick={() => navigate('/recording')}>Open recording workspace <span>→</span></button></section>
          <section className="dashboard-card"><div className="activity-heading"><div><p className="section-kicker">RECENT ACTIVITY</p><h3>Incident timeline</h3></div><button onClick={() => navigate('/history')} className="text-link">View history →</button></div><div className="timeline">{incidents.slice(0, 4).map((incident) => <div className="timeline-item" key={incident.id}><span className="timeline-dot danger" /><div><strong>{incident.type.replace(/_/g, ' ')}</strong><small>{incident.details}</small></div><time>{new Date(incident.timestamp).toLocaleTimeString()}</time></div>)}{incidents.length === 0 && <div className="empty-dashboard">No incidents recorded yet. Start monitoring to populate your timeline.</div>}</div></section>
        </div>
        {sessionRole === 'admin' && <section className="dashboard-card user-admin-card"><div className="activity-heading"><div><p className="section-kicker">ACCESS CONTROL</p><h3>Manage users</h3></div><span className="admin-badge">ADMIN</span></div><form className="user-form" onSubmit={createUser}><input type="email" placeholder="user@example.com" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} required /><input type="password" placeholder="Temporary password (10+ chars)" minLength="10" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} required /><select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}><option value="operator">Operator</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button className="test-btn primary-action" type="submit">Add user</button></form>{userError && <p className="error-notification">{userError}</p>}<div className="user-list">{users.map((user) => <div className="user-row" key={user.id}><span>{user.email}</span><strong>{user.role}</strong><em className={user.active ? 'up' : ''}>{user.active ? 'Active' : 'Disabled'}</em></div>)}</div></section>}
        <section className="dashboard-card camera-admin-card"><div className="activity-heading"><div><p className="section-kicker">CAMERA REGISTRY</p><h3>{sessionRole === 'admin' ? 'All registered cameras' : 'My registered cameras'}</h3></div><span className="admin-badge">{cameras.length} REGISTERED</span></div><p className="camera-note">Registration and signaling metadata only. Live remote video requires a camera publisher and WebRTC client; this does not create a stream.</p><form className="camera-form" onSubmit={registerCamera}><input placeholder="Camera name" value={newCamera.name} onChange={(event) => setNewCamera({ ...newCamera, name: event.target.value })} required /><input type="url" placeholder="Stream URL (optional)" value={newCamera.streamUrl} onChange={(event) => setNewCamera({ ...newCamera, streamUrl: event.target.value })} /><input placeholder="Location / source metadata" value={newCamera.location} onChange={(event) => setNewCamera({ ...newCamera, location: event.target.value })} /><select value={newCamera.sourceType} onChange={(event) => setNewCamera({ ...newCamera, sourceType: event.target.value })}><option value="publisher">Remote publisher</option><option value="local">Local browser camera</option></select><button className="test-btn primary-action" type="submit">Register camera</button></form>{cameraError && <p className="error-notification">{cameraError}</p>}<div className="camera-registry-list">{cameras.map((camera) => <div className="camera-registry-row" key={camera.id}><div><strong>{camera.name}</strong><small>{camera.location || camera.description || 'No source metadata'}{sessionRole === 'admin' && camera.owner_email ? ` · ${camera.owner_email}` : ''}</small></div><span className="camera-state">{camera.source_type === 'local' ? 'Local / browser' : 'Registered · publisher needed'}</span><div><button className="text-link" type="button" onClick={() => navigate(`/camera-publisher/${camera.id}`)}>Publish</button><button className="text-link" type="button" onClick={() => removeCamera(camera)}>Remove</button></div></div>)}{cameras.length === 0 && <div className="empty-dashboard">No cameras registered yet.</div>}</div></section>
      </div>
    </div>
  );
};

export default Dashboard;
