import React, { useState, useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { useNavigate } from 'react-router-dom';
import { saveIncident } from '../utils/db';
import './New.css';

const SafetyMonitoringSystem = () => {
  const [model, setModel] = useState(null);
  const [detections, setDetections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState([]);
  const [capturedImage, setCapturedImage] = useState(null);
  const [detectionHistory, setDetectionHistory] = useState([]);
  const [isAlertVisible, setIsAlertVisible] = useState(false);
  const [alertType, setAlertType] = useState(null);
  const [isTelegramSending, setIsTelegramSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const navigate = useNavigate();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  
  // Recording refs
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const incidentTracker = useRef({
    activeType: null,
    firstDetectedAt: 0,
    lastDetectedAt: 0,
    isRecording: false,
    telegramSent: false,
    initialIncidentData: null
  });

  const TELEGRAM_BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '';
  const TELEGRAM_CHAT_IDS = (import.meta.env.VITE_TELEGRAM_CHAT_IDS || '').split(',').map(id => id.trim()).filter(id => id);

  const CROWD_THRESHOLD = 3;
  const CONFIDENCE_THRESHOLD = 0.6;
  const CROWD_DENSITY_THRESHOLD = 0.25;
  const FIRE_COLOR_THRESHOLD = 0.7; 
  const FIRE_PIXEL_THRESHOLD = 0.02;

  const ADDITIONAL_OBJECTS = ['mobile phone', 'book', 'handbag', 'backpack', 'shoe', 'laptop'];

  const logDebug = (message) => {
    setDebugInfo((prev) => [...prev.slice(-50), `${new Date().toLocaleTimeString()}: ${message}`]);
    console.log(message);
  };

  useEffect(() => {
    const loadModel = async () => {
      try {
        logDebug('Initializing TensorFlow.js...');
        await tf.ready();
        logDebug('Loading COCO-SSD model...');
        const loadedModel = await cocoSsd.load({ base: 'mobilenet_v2' });
        setModel(loadedModel);
        setIsLoading(false);
        logDebug('Model loaded successfully');
      } catch (err) {
        const errorMessage = `Model loading failed: ${err.message}`;
        setError(errorMessage);
        logDebug(errorMessage);
        setIsLoading(false);
      }
    };
    loadModel();

    navigator.mediaDevices.enumerateDevices().then(devices => {
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setDevices(videoDevices);
      if (videoDevices.length > 0) {
        setSelectedDeviceId(videoDevices[0].deviceId);
      }
    }).catch(err => console.error("Error enumerating devices:", err));
  }, []);

  const startWebcam = async () => {
    try {
      const constraints = {
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 }, 
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined 
        }
      };
      // If already playing, stop tracks first
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          if (canvasRef.current) {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
          }
          if (captureCanvasRef.current) {
            captureCanvasRef.current.width = videoRef.current.videoWidth;
            captureCanvasRef.current.height = videoRef.current.videoHeight;
          }
          startDetection();
        };
      }
    } catch (err) {
      const errorMessage = `Webcam access failed: ${err.message}`;
      setError(errorMessage);
      logDebug(errorMessage);
    }
  };

  const detectFire = () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return false;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let firePixelCount = 0;
    const totalPixels = canvas.width * canvas.height;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      if (r > 200 && g < 150 && b < 100) firePixelCount++;
    }
    return (firePixelCount / totalPixels) > FIRE_PIXEL_THRESHOLD;
  };

  const detectIncident = async (predictions) => {
    const people = predictions.filter(pred => pred.class === 'person' && pred.score > CONFIDENCE_THRESHOLD);
    const vehicles = predictions.filter(pred => ['car', 'truck', 'motorcycle', 'bus', 'bicycle'].includes(pred.class) && pred.score > CONFIDENCE_THRESHOLD);
    const fireIndicators = predictions.filter(pred => ['fire hydrant', 'fire truck'].includes(pred.class) && pred.score > CONFIDENCE_THRESHOLD);
    const additionalObjects = predictions.filter(pred => ADDITIONAL_OBJECTS.includes(pred.class) && pred.score > CONFIDENCE_THRESHOLD);

    if (people.length >= CROWD_THRESHOLD && calculateCrowdDensity(people) > CROWD_DENSITY_THRESHOLD) {
      return { type: 'overcrowd', confidence: Math.max(...people.map(p => p.score)), count: people.length };
    }
    if (vehicles.length >= 2 && detectCollision(vehicles).length > 0) {
      return { type: 'accident', confidence: Math.max(...vehicles.map(v => v.score)) };
    }
    if (fireIndicators.length > 0 || detectFire()) return { type: 'fire', confidence: 0.8 };
    if (additionalObjects.length > 0) return { type: 'object_movement', confidence: Math.max(...additionalObjects.map(o => o.score)), objects: additionalObjects.map(o => o.class) };
    return null;
  };

  const calculateCrowdDensity = (people) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const totalArea = canvas.width * canvas.height;
    const peopleArea = people.reduce((acc, person) => {
      const [, , width, height] = person.bbox;
      return acc + (width * height);
    }, 0);
    return peopleArea / totalArea;
  };

  const detectCollision = (vehicles) => {
    const collisionPairs = [];
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        if (checkBoxOverlap(vehicles[i].bbox, vehicles[j].bbox)) collisionPairs.push([vehicles[i], vehicles[j]]);
      }
    }
    return collisionPairs;
  };

  const checkBoxOverlap = (bbox1, bbox2) => {
    const [x1, y1, w1, h1] = bbox1; const [x2, y2, w2, h2] = bbox2;
    return !(x1 + w1 < x2 || x2 + w2 < x1 || y1 + h1 < y2 || y2 + h2 < y1);
  };

  const getDetectionColor = (className, alpha = 1) => {
    switch (className) {
      case 'person': return `rgba(0, 255, 0, ${alpha})`;
      case 'car': case 'truck': case 'motorcycle': case 'bus': return `rgba(255, 0, 0, ${alpha})`;
      case 'fire hydrant': case 'fire truck': return `rgba(255, 106, 0, ${alpha})`;
      case 'mobile phone': case 'book': case 'handbag': case 'backpack': case 'shoe': case 'laptop': return `rgba(128, 0, 128, ${alpha})`;
      default: return `rgba(0, 0, 255, ${alpha})`;
    }
  };

  const dataURItoBlob = (dataURI) => {
    const byteString = atob(dataURI.split(',')[1]);
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) uint8Array[i] = byteString.charCodeAt(i);
    return new Blob([uint8Array], { type: mimeString });
  };

  const sendToTelegram = async (incident) => {
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_CHAT_IDS.length === 0) return;
    setIsTelegramSending(true);
    try {
      const message = `<b>🚨 Incident Detected 🚨</b>\n<b>Type:</b> ${incident.type.toUpperCase().replace(/_/g, ' ')}\n<b>Confidence:</b> ${incident.confidence}%\n<b>Location:</b> ${incident.location || 'Not available'}\n<b>Details:</b> ${incident.details}\n<b>Time:</b> ${incident.timestamp}`;

      for (const chatId of TELEGRAM_CHAT_IDS) {
        if (incident.image) {
          const formData = new FormData();
          formData.append('chat_id', chatId);
          formData.append('photo', dataURItoBlob(incident.image), 'incident.jpg');
          formData.append('caption', message);
          formData.append('parse_mode', 'HTML');
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: formData });
        }
      }
      logDebug('Telegram notification sent successfully');
    } catch (error) {
      logDebug(`Telegram error: ${error.message}`);
    } finally {
      setIsTelegramSending(false);
    }
  };

  // Video recording functions
  const startRecording = () => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    try {
      const stream = videoRef.current.srcObject;
      // Use compressed video settings
      const options = { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 250000 };
      let mediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        // Fallback if codec not supported
        mediaRecorder = new MediaRecorder(stream, { videoBitsPerSecond: 250000 });
      }
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        recordedChunksRef.current = [];
        
        // Save to IndexedDB
        if (incidentTracker.current.initialIncidentData) {
          const incidentToSave = {
            ...incidentTracker.current.initialIncidentData,
            videoBlob: blob
          };
          await saveIncident(incidentToSave);
          logDebug('Incident saved to History with Video');
        }
        
        // Reset tracking
        incidentTracker.current = { activeType: null, firstDetectedAt: 0, lastDetectedAt: 0, isRecording: false, telegramSent: false, initialIncidentData: null };
        setIsRecording(false);
      };

      recordedChunksRef.current = [];
      mediaRecorder.start(1000); // chunk every second
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      incidentTracker.current.isRecording = true;
      logDebug('Started recording incident');
    } catch (e) {
      console.error('Recording error:', e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      logDebug('Stopped recording');
    }
  };

  const captureVideoFrame = () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6); // compressed image
  };

  const processIncidentState = (incident) => {
    const now = Date.now();
    const tracker = incidentTracker.current;

    if (incident) {
      // Incident detected
      if (tracker.activeType !== incident.type) {
        // New incident type started
        tracker.activeType = incident.type;
        tracker.firstDetectedAt = now;
        tracker.lastDetectedAt = now;
        tracker.telegramSent = false;
        
        const incidentDetails = {
          id: now.toString(),
          timestamp: new Date().getTime(),
          image: captureVideoFrame(),
          type: incident.type,
          confidence: Math.round(incident.confidence * 100),
          location: 'Bangalore, Karnataka',
          details: incident.type === 'overcrowd' ? `${incident.count} people detected` : incident.type === 'accident' ? 'Multiple vehicles detected' : incident.type === 'object_movement' ? `Detected: ${incident.objects.join(', ')}` : 'Fire-related objects detected',
        };
        tracker.initialIncidentData = incidentDetails;
        
        setDetectionHistory((prev) => [incidentDetails, ...prev.slice(0, 9)]);
        setAlertType(incident.type);
        setCapturedImage(incidentDetails.image);
        setIsAlertVisible(true);
      } else {
        // Ongoing incident
        tracker.lastDetectedAt = now;
        
        // Send telegram if not sent yet
        if (!tracker.telegramSent) {
          tracker.telegramSent = true;
          sendToTelegram(tracker.initialIncidentData);
        }

        // Check if 15 seconds passed and not recording
        if (!tracker.isRecording && (now - tracker.firstDetectedAt) > 15000) {
          startRecording();
        }
      }
    } else {
      // No incident detected currently
      if (tracker.activeType) {
        // Check if incident is over (5 seconds without detection)
        if (now - tracker.lastDetectedAt > 5000) {
          if (tracker.isRecording) {
            stopRecording();
          } else {
            // Save to history without video if < 15s
            if (tracker.initialIncidentData) {
              saveIncident(tracker.initialIncidentData);
            }
            tracker.activeType = null;
          }
        }
      }
    }
  };

  const detectObjects = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !model || video.readyState < 2) return;
    try {
      const predictions = await model.detect(video);
      const incident = await detectIncident(predictions);
      setDetections(predictions);

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      predictions.forEach((prediction) => {
        const [x, y, width, height] = prediction.bbox;
        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = getDetectionColor(prediction.class, 0.7);
        ctx.rect(x, y, width, height);
        ctx.stroke();
        const label = `${prediction.class} (${Math.round(prediction.score * 100)}%)`;
        ctx.font = '14px Arial';
        const labelWidth = ctx.measureText(label).width;
        ctx.fillStyle = getDetectionColor(prediction.class, 0.8);
        ctx.fillRect(x, y - 20, labelWidth + 10, 20);
        ctx.fillStyle = 'white';
        ctx.fillText(label, x + 5, y - 5);
      });

      processIncidentState(incident);
    } catch (error) {
      console.error('Object detection error:', error);
    }
  };

  const startDetection = () => {
    if (!model || !videoRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const detectFrame = async () => {
      await detectObjects();
      requestAnimationFrame(detectFrame);
    };
    detectFrame();
  };

  useEffect(() => {
    if (isAlertVisible) {
      const timer = setTimeout(() => setIsAlertVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [isAlertVisible]);

  const getAlertTitle = (type) => {
    switch (type) {
      case 'fire': return '🔥 Fire Hazard Detected!';
      case 'overcrowd': return '👥 Overcrowding Detected!';
      case 'accident': return '🚨 Potential Accident Detected!';
      case 'object_movement': return '📱 Object Movement Detected!';
      default: return '⚠️ Incident Detected!';
    }
  };

  return (
    <div className="safety-monitoring-container">
      <div className="monitoring-wrapper">
        {/* ─── HEADER ─── */}
        <header className="monitoring-header">
          <div className="header-content">
            <h1 className="system-title">
              <span className="ai-icon">🤖</span> AI Safety Monitoring
            </h1>
            <div className="header-actions">
              <button onClick={() => navigate('/history')} className="test-btn">📅 History</button>
              <div className={`telegram-status ${TELEGRAM_BOT_TOKEN ? 'status-online' : 'status-offline'}`}>
                Telegram: {TELEGRAM_BOT_TOKEN ? 'Connected' : 'Not Configured'}
              </div>
            </div>
          </div>
          {error && <div className="error-notification">{error}</div>}
        </header>

        {/* ─── MAIN LAYOUT ─── */}
        <div className="monitor-layout">
          {/* Video Feed */}
          <div className="video-monitoring-section">
            {/* Recording indicator bar */}
            {isRecording && (
              <div className="recording-bar" onClick={stopRecording}>
                <span className="recording-dot"></span>
                <span style={{color: 'white', fontSize: '0.8rem', fontWeight: 700}}>REC — Click to Stop</span>
              </div>
            )}

            <div className="video-canvas-container">
              <video ref={videoRef} className="monitoring-video" autoPlay playsInline muted />
              <canvas ref={canvasRef} className="detection-overlay-canvas" />
            </div>

            {/* Alert overlay inside video section */}
            {isAlertVisible && capturedImage && (
              <div className="incident-alert-container">
                <div className="incident-alert-content">
                  <img src={capturedImage} alt="Detected Incident" className="incident-capture-image" />
                  <div>
                    <h3 className="alert-title">{getAlertTitle(alertType)}</h3>
                    <p className="alert-description">
                      {alertType === 'overcrowd' ? 'Too many people detected in the area!' : alertType === 'accident' ? 'Potential vehicle collision detected!' : 'Incident detected by AI!'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Side Panel */}
          <div className="side-panel">
            {/* Camera Card */}
            <div className="side-panel-card">
              <span className="side-panel-label">📷 Camera</span>
              <select 
                value={selectedDeviceId} 
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="camera-select"
              >
                {devices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId.substring(0,5)}`}
                  </option>
                ))}
              </select>
              <button 
                onClick={startWebcam} 
                className={`btn-camera ${isLoading ? 'disabled' : 'active'}`} 
                disabled={isLoading}
              >
                {isLoading ? "Loading..." : (videoRef.current?.srcObject ? "🔄 Switch" : "▶ Start")}
              </button>
            </div>

            {/* Status Card */}
            <div className="side-panel-card">
              <span className="side-panel-label">Status</span>
              <div className={`status-pill ${videoRef.current?.srcObject ? 'live' : 'idle'}`}>
                <span className="status-dot"></span>
                {videoRef.current?.srcObject ? 'Monitoring' : 'Idle'}
              </div>
              {isRecording && (
                <div className="status-pill" style={{background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)'}}>
                  <span className="status-dot"></span>
                  Recording
                </div>
              )}
            </div>

            {/* Stats Card */}
            <div className="side-panel-card">
              <span className="side-panel-label">Session</span>
              <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '6px'}}>
                  <span>Detections</span>
                  <strong style={{color: 'var(--text-primary)'}}>{detections.length}</strong>
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between'}}>
                  <span>Incidents</span>
                  <strong style={{color: detectionHistory.length > 0 ? 'var(--danger)' : 'var(--text-primary)'}}>{detectionHistory.length}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── LIVE INCIDENT FEED ─── */}
        {detectionHistory.length > 0 && (
          <div className="detection-history-container">
            <h3 className="history-title">Recent Incidents</h3>
            <div className="history-grid">
              {detectionHistory.map((detection, index) => (
                <div key={index} className="history-item">
                  <img src={detection.image} alt="Detection" />
                  <div className="history-item-details">
                    <div className="history-item-type">{detection.type.replace(/_/g, ' ')}</div>
                    <div className="history-item-time">{new Date(detection.timestamp).toLocaleTimeString()}</div>
                    <div className="history-item-desc">{detection.details}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <canvas ref={captureCanvasRef} width={640} height={480} className="hidden-capture-canvas" />
    </div>
  );
};

export default SafetyMonitoringSystem;