import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { getAllIncidents, cleanOldIncidents } from '../utils/db';
import './New.css';

const History = () => {
  const [incidents, setIncidents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);
  
  // Modal state
  const [selectedMedia, setSelectedMedia] = useState(null); // { type: 'image' | 'video', url: string }

  const navigate = useNavigate();

  useEffect(() => {
    const loadHistory = async () => {
      try {
        await cleanOldIncidents(10);
        const data = await getAllIncidents();
        
        const processedData = data.map(inc => ({
          ...inc,
          videoUrl: inc.videoBlob ? URL.createObjectURL(inc.videoBlob) : null
        }));
        
        setIncidents(processedData);
      } catch (error) {
        console.error("Failed to load history:", error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadHistory();
    
    return () => {
      incidents.forEach(inc => {
        if (inc.videoUrl) URL.revokeObjectURL(inc.videoUrl);
      });
    };
  }, []);

  // Check if a date has incidents
  const hasIncidentOnDate = (date) => {
    return incidents.some(inc => {
      const incDate = new Date(inc.timestamp);
      return incDate.getDate() === date.getDate() &&
             incDate.getMonth() === date.getMonth() &&
             incDate.getFullYear() === date.getFullYear();
    });
  };

  // Filter incidents for the selected date
  const filteredIncidents = incidents.filter(inc => {
    const incDate = new Date(inc.timestamp);
    return incDate.getDate() === selectedDate.getDate() &&
           incDate.getMonth() === selectedDate.getMonth() &&
           incDate.getFullYear() === selectedDate.getFullYear();
  });

  const videoIncidents = filteredIncidents.filter(inc => inc.videoUrl);
  const pictureIncidents = filteredIncidents.filter(inc => !inc.videoUrl);

  const openModal = (type, url) => {
    setSelectedMedia({ type, url });
  };

  const closeModal = () => {
    setSelectedMedia(null);
  };

  return (
    <div className="safety-monitoring-container" style={{overflowY: 'auto', maxHeight: '100vh', position: 'relative'}}>
      <div className="monitoring-wrapper" style={{maxWidth: '1200px', margin: '0 auto'}}>
        <header className="monitoring-header">
          <div className="header-content">
            <h1 className="system-title">
              <span className="ai-icon">📅</span> Incident History
            </h1>
            <div className="header-actions">
              <button onClick={() => navigate('/safety-monitoring-system')} className="test-btn">
                Back to Monitoring
              </button>
            </div>
          </div>
        </header>
        
        <div className="monitoring-main-content" style={{padding: '20px', display: 'flex', gap: '30px', flexWrap: 'wrap'}}>
          
          {/* Calendar Section (Left Side) */}
          <div style={{flex: '1', minWidth: '300px', maxWidth: '350px'}}>
            <div style={{backgroundColor: '#2a2a2a', padding: '15px', borderRadius: '10px'}}>
              <h3 style={{color: 'white', marginTop: 0}}>Select Date</h3>
              <Calendar 
                onChange={setSelectedDate} 
                value={selectedDate}
                className="dark-calendar"
                tileClassName={({ date, view }) => {
                  if (view === 'month' && hasIncidentOnDate(date)) {
                    return 'has-incident-day';
                  }
                }}
              />
            </div>
          </div>

          {/* Incidents Section (Right Side) */}
          <div style={{flex: '2', minWidth: '300px'}}>
            <h2 style={{color: 'white', marginTop: 0}}>
              Incidents on {selectedDate.toLocaleDateString()}
            </h2>

            {isLoading ? (
              <div style={{color: 'white'}}>Loading history...</div>
            ) : filteredIncidents.length === 0 ? (
              <div style={{color: '#aaa', padding: '20px', backgroundColor: '#1e1e1e', borderRadius: '10px'}}>
                No incidents recorded on this date.
              </div>
            ) : (
              <div style={{display: 'flex', flexDirection: 'column', gap: '30px'}}>
                
                {/* Videos Section */}
                {videoIncidents.length > 0 && (
                  <div>
                    <h3 style={{color: '#ff4d4d', borderBottom: '1px solid #444', paddingBottom: '10px'}}>Recorded Videos</h3>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '15px', marginTop: '15px'}}>
                      {videoIncidents.map(inc => (
                        <div key={inc.id} style={{backgroundColor: '#2a2a2a', padding: '10px', borderRadius: '8px', width: '220px'}}>
                          <div 
                            style={{position: 'relative', cursor: 'pointer'}} 
                            onClick={() => openModal('video', inc.videoUrl)}
                          >
                            <img src={inc.image} alt="Thumbnail" style={{width: '100%', height: '120px', objectFit: 'cover', borderRadius: '5px', opacity: 0.7}} />
                            <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '30px'}}>▶️</div>
                          </div>
                          <div style={{marginTop: '10px', color: 'white', fontSize: '13px'}}>
                            <strong>{inc.type.toUpperCase().replace(/_/g, ' ')}</strong><br/>
                            <span style={{color: '#aaa'}}>{new Date(inc.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pictures Section */}
                {pictureIncidents.length > 0 && (
                  <div>
                    <h3 style={{color: '#4db8ff', borderBottom: '1px solid #444', paddingBottom: '10px'}}>Snapshot Pictures</h3>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '15px', marginTop: '15px'}}>
                      {pictureIncidents.map(inc => (
                        <div key={inc.id} style={{backgroundColor: '#2a2a2a', padding: '10px', borderRadius: '8px', width: '220px'}}>
                          <img 
                            src={inc.image} 
                            alt="Snapshot" 
                            style={{width: '100%', height: '120px', objectFit: 'cover', borderRadius: '5px', cursor: 'pointer'}} 
                            onClick={() => openModal('image', inc.image)}
                          />
                          <div style={{marginTop: '10px', color: 'white', fontSize: '13px'}}>
                            <strong>{inc.type.toUpperCase().replace(/_/g, ' ')}</strong><br/>
                            <span style={{color: '#aaa'}}>{new Date(inc.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Media Modal */}
      {selectedMedia && (
        <div 
          style={{position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000}}
          onClick={closeModal}
        >
          <button 
            style={{position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'white', fontSize: '30px', cursor: 'pointer'}}
            onClick={closeModal}
          >
            ×
          </button>
          
          <div onClick={e => e.stopPropagation()} style={{maxWidth: '90%', maxHeight: '90%'}}>
            {selectedMedia.type === 'video' ? (
              <video src={selectedMedia.url} controls autoPlay style={{maxWidth: '100%', maxHeight: '90vh', borderRadius: '8px'}} />
            ) : (
              <img src={selectedMedia.url} alt="Full size" style={{maxWidth: '100%', maxHeight: '90vh', borderRadius: '8px'}} />
            )}
          </div>
        </div>
      )}

      {/* Inject basic calendar dark mode styles */}
      <style>{`
        .dark-calendar {
          background-color: #1e1e1e;
          border: none;
          color: white;
          border-radius: 8px;
          padding: 10px;
        }
        .react-calendar__navigation button {
          color: white;
          min-width: 44px;
          background: none;
        }
        .react-calendar__navigation button:enabled:hover,
        .react-calendar__navigation button:enabled:focus {
          background-color: #333;
        }
        .react-calendar__month-view__days__day {
          color: white;
        }
        .react-calendar__tile:enabled:hover,
        .react-calendar__tile:enabled:focus {
          background-color: #333;
          border-radius: 5px;
        }
        .react-calendar__tile--now {
          background: #444;
          border-radius: 5px;
        }
        .react-calendar__tile--active {
          background: #0066cc !important;
          color: white;
          border-radius: 5px;
        }
        .has-incident-day {
          background-color: rgba(255, 77, 77, 0.2);
          border-bottom: 2px solid #ff4d4d;
        }
        .react-calendar__month-view__days__day--neighboringMonth {
          color: #666;
        }
      `}</style>
    </div>
  );
};

export default History;
