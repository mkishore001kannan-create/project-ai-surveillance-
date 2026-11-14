import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { getAllIncidents, cleanOldIncidents } from '../utils/db';
import './New.css';

const isSameDay = (first, second) => first.toDateString() === second.toDateString();

const History = () => {
  const [incidents, setIncidents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedMedia, setSelectedMedia] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mediaUrls = [];
    let active = true;
    const loadHistory = async () => {
      try {
        await cleanOldIncidents(10);
        const data = await getAllIncidents();
        const processedData = data.map((incident) => ({
          ...incident,
          videoUrl: incident.videoBlob ? URL.createObjectURL(incident.videoBlob) : null,
        }));
        mediaUrls = processedData.filter((incident) => incident.videoUrl).map((incident) => incident.videoUrl);
        if (active) setIncidents(processedData);
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : 'Unable to load incident history.');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadHistory();
    return () => {
      active = false;
      mediaUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!selectedMedia) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSelectedMedia(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedMedia]);

  const hasIncidentOnDate = (date) => incidents.some((incident) => isSameDay(new Date(incident.timestamp), date));
  const filteredIncidents = incidents.filter((incident) => isSameDay(new Date(incident.timestamp), selectedDate));
  const videoIncidents = filteredIncidents.filter((incident) => incident.videoUrl);
  const pictureIncidents = filteredIncidents.filter((incident) => !incident.videoUrl);

  const renderIncidentCard = (incident, type) => {
    const mediaUrl = type === 'video' ? incident.videoUrl : incident.image;
    const label = `${incident.type.replace(/_/g, ' ')} ${type === 'video' ? 'video' : 'snapshot'}`;
    return (
      <article className="history-card" key={incident.id}>
        <button
          className="history-media-trigger"
          type="button"
          onClick={() => setSelectedMedia({ type, url: mediaUrl })}
          aria-label={`Open ${label}`}
        >
          {incident.image && <img src={incident.image} alt="" />}
          {type === 'video' && <span className="history-play-icon" aria-hidden="true">▶</span>}
        </button>
        <div className="history-card-details">
          <strong>{incident.type.replace(/_/g, ' ')}</strong>
          <time dateTime={new Date(incident.timestamp).toISOString()}>
            {new Date(incident.timestamp).toLocaleTimeString()}
          </time>
          {incident.details && <p>{incident.details}</p>}
        </div>
      </article>
    );
  };

  return (
    <div className="safety-monitoring-container history-page">
      <div className="monitoring-wrapper history-wrapper">
        <header className="monitoring-header">
          <div className="header-content">
            <h1 className="system-title"><span className="ai-icon">📅</span> Incident History</h1>
            <div className="header-actions">
              <button onClick={() => navigate('/dashboard')} className="test-btn">Back to Dashboard</button>
              <button onClick={() => navigate('/recording')} className="test-btn primary-action">Recording</button>
            </div>
          </div>
        </header>

        <main className="history-layout">
          <aside className="history-calendar-card">
            <h2>Select date</h2>
            <Calendar
              onChange={setSelectedDate}
              value={selectedDate}
              className="history-calendar"
              tileClassName={({ date, view }) => view === 'month' && hasIncidentOnDate(date) ? 'has-incident-day' : null}
            />
          </aside>

          <section className="history-results" aria-live="polite">
            <h2>Incidents on {selectedDate.toLocaleDateString()}</h2>
            {loadError && <p className="history-error" role="alert">{loadError}</p>}
            {isLoading ? (
              <p className="history-empty">Loading incident history…</p>
            ) : loadError ? (
              <p className="history-empty">Check your connection and try again.</p>
            ) : filteredIncidents.length === 0 ? (
              <p className="history-empty">No incidents recorded on this date.</p>
            ) : (
              <>
                {videoIncidents.length > 0 && (
                  <section className="history-section">
                    <h3 className="history-section-title video-title">Recorded videos</h3>
                    <div className="history-grid">{videoIncidents.map((incident) => renderIncidentCard(incident, 'video'))}</div>
                  </section>
                )}
                {pictureIncidents.length > 0 && (
                  <section className="history-section">
                    <h3 className="history-section-title image-title">Snapshot images</h3>
                    <div className="history-grid">{pictureIncidents.map((incident) => renderIncidentCard(incident, 'image'))}</div>
                  </section>
                )}
              </>
            )}
          </section>
        </main>
      </div>

      {selectedMedia && (
        <div className="history-modal" role="presentation" onClick={() => setSelectedMedia(null)}>
          <section
            className="history-modal-content"
            role="dialog"
            aria-modal="true"
            aria-label={selectedMedia.type === 'video' ? 'Recorded video' : 'Incident snapshot'}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="history-modal-close" type="button" onClick={() => setSelectedMedia(null)} aria-label="Close media">×</button>
            {selectedMedia.type === 'video'
              ? <video src={selectedMedia.url} controls autoPlay />
              : <img src={selectedMedia.url} alt="Full-size incident snapshot" />}
          </section>
        </div>
      )}
    </div>
  );
};

export default History;
