import { useState, useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { useNavigate } from 'react-router-dom';
import { saveIncident } from '../utils/db';
import { useTheme } from '../useTheme';
import './New.css';
import { RemoteCameraPanel } from './RemoteCamera';

const SafetyMonitoringSystem = () => {
  const [model, setModel] = useState(null);
  const [detections, setDetections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modelLoadAttempt, setModelLoadAttempt] = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);
  const [detectionHistory, setDetectionHistory] = useState([]);
  const [isAlertVisible, setIsAlertVisible] = useState(false);
  const [alertType, setAlertType] = useState(null);
  const [isTelegramSending, setIsTelegramSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lastRecordingUrl, setLastRecordingUrl] = useState('');
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [cameraFeeds, setCameraFeeds] = useState([]);
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const videoRefs = useRef(new Map());
  const canvasRefs = useRef(new Map());
  const captureCanvasRef = useRef(null);
  
  // Recording refs
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const lastRecordingUrlRef = useRef('');
  const detectionFrameRef = useRef(null);
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
  const FIRE_PIXEL_THRESHOLD = 0.02;

  const ADDITIONAL_OBJECTS = ['mobile phone', 'book', 'handbag', 'backpack', 'shoe', 'laptop'];

  const logDebug = (message) => {
    console.log(message);
  };

  const discoverCameras = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is unavailable. Use HTTPS and a supported browser.');
    }
    let videoDevices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'videoinput');
    if (!videoDevices.length) {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      videoDevices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'videoinput');
    }
    setDevices(videoDevices);
    setSelectedDeviceId((current) => current || videoDevices[0]?.deviceId || '');
    setCameraFeeds(videoDevices.map((device) => ({ device, stream: null, predictions: [], status: 'ready' })));
    return videoDevices;
  };

  useEffect(() => {
    let active = true;
    const loadModel = async () => {
      try {
        logDebug('Initializing TensorFlow.js...');
        await tf.ready();
        logDebug('Loading COCO-SSD model...');
        let loadedModel;
        try {
          loadedModel = await cocoSsd.load({ base: 'mobilenet_v2' });
        } catch (primaryError) {
          logDebug(`MobileNet V2 model failed: ${primaryError.message}. Retrying with MobileNet V1.`);
          loadedModel = await cocoSsd.load({ base: 'mobilenet_v1' });
        }
        if (!active) return;
        setModel(loadedModel);
        setIsLoading(false);
        logDebug('Model loaded successfully');
      } catch (err) {
        const errorMessage = `Model loading failed: ${err.message}`;
        if (!active) return;
        setError(`${errorMessage} Camera recording can still be used; retry AI when the network or browser cache is available.`);
        logDebug(errorMessage);
        setIsLoading(false);
      }
    };
    loadModel();

    discoverCameras().then(videoDevices => {
      if (!active) return;
      if (!videoDevices.length) setError('No connected cameras were found. Connect a camera and try again.');
    }).catch(err => {
      if (active) setError(err.message || 'Unable to access cameras.');
    });

    return () => {
      active = false;
    };
  }, [modelLoadAttempt]);

  const startWebcam = async () => {
    setError(null);
    let availableDevices = devices;
    try {
      if (!availableDevices.length) availableDevices = await discoverCameras();
    } catch (err) {
      setError(err.message || 'Unable to access cameras.');
      return;
    }
    if (!availableDevices.length) {
      setError('No connected cameras were found. Connect a camera and try again.');
      return;
    }
    cameraFeeds.forEach((feed) => {
      feed.stream?.getTracks().forEach((track) => track.stop());
    });
    const nextFeeds = [];
    for (const device of availableDevices) {
      try {
        const videoConstraints = {
          width: { ideal: 640 },
          height: { ideal: 480 },
          ...(device.deviceId ? { deviceId: { exact: device.deviceId } } : {}),
        };
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
        } catch (deviceError) {
          if (!device.deviceId) throw deviceError;
          logDebug(`Camera ${device.label || device.deviceId} could not be opened by ID; retrying default camera.`);
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        const video = videoRefs.current.get(device.deviceId);
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        nextFeeds.push({ device, stream, predictions: [], status: 'live' });
      } catch (err) {
        const errorMessage = err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in the browser and retry.'
          : err.name === 'NotFoundError'
            ? 'No camera is available on this device.'
            : err.message || 'The camera could not be opened.';
        nextFeeds.push({ device, stream: null, predictions: [], status: 'error', error: errorMessage });
        logDebug(`Camera ${device.label || device.deviceId} failed: ${errorMessage}`);
      }
    }
    setCameraFeeds(nextFeeds);
  };

  const detectFire = (video, canvas) => {
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

  const detectIncident = async (predictions, canvas, video) => {
    const people = predictions.filter(pred => pred.class === 'person' && pred.score > CONFIDENCE_THRESHOLD);
    const vehicles = predictions.filter(pred => ['car', 'truck', 'motorcycle', 'bus', 'bicycle'].includes(pred.class) && pred.score > CONFIDENCE_THRESHOLD);
    const fireIndicators = predictions.filter(pred => ['fire hydrant', 'fire truck'].includes(pred.class) && pred.score > CONFIDENCE_THRESHOLD);
    const additionalObjects = predictions.filter(pred => ADDITIONAL_OBJECTS.includes(pred.class) && pred.score > CONFIDENCE_THRESHOLD);

    if (people.length >= CROWD_THRESHOLD && calculateCrowdDensity(people, canvas) > CROWD_DENSITY_THRESHOLD) {
      return { type: 'overcrowd', confidence: Math.max(...people.map(p => p.score)), count: people.length };
    }
    if (vehicles.length >= 2 && detectCollision(vehicles).length > 0) {
      return { type: 'accident', confidence: Math.max(...vehicles.map(v => v.score)) };
    }
    if (fireIndicators.length > 0 || detectFire(video, canvas)) return { type: 'fire', confidence: 0.8 };
    if (additionalObjects.length > 0) return { type: 'object_movement', confidence: Math.max(...additionalObjects.map(o => o.score)), objects: additionalObjects.map(o => o.class) };
    return null;
  };

  const calculateCrowdDensity = (people, canvas) => {
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
    const focusedVideo = videoRefs.current.get(selectedDeviceId);
    if (!focusedVideo || !focusedVideo.srcObject) {
      setError('Start a live camera before recording.');
      return;
    }
    try {
      const stream = focusedVideo.srcObject;
      if (!stream.getVideoTracks().length) {
        setError('The selected camera has no active video track.');
        return;
      }
      const mimeTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const mediaRecorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 250000,
      });
      if (!incidentTracker.current.initialIncidentData) {
        incidentTracker.current.initialIncidentData = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          image: captureVideoFrame(focusedVideo),
          type: 'manual_recording',
          confidence: 100,
          location: 'Local camera',
          details: `Manual recording from ${devices.find((device) => device.deviceId === selectedDeviceId)?.label || 'selected camera'}`,
        };
      }
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        recordedChunksRef.current = [];
        if (blob.size === 0) {
          setError('The recording finished without video data. Try starting the camera again.');
        } else {
          const recordingUrl = URL.createObjectURL(blob);
          setLastRecordingUrl((previousUrl) => {
            if (previousUrl) URL.revokeObjectURL(previousUrl);
            lastRecordingUrlRef.current = recordingUrl;
            return recordingUrl;
          });
          const downloadLink = document.createElement('a');
          downloadLink.href = recordingUrl;
          downloadLink.download = `sentinel-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
          downloadLink.click();
        }
        
        try {
          if (incidentTracker.current.initialIncidentData) {
            const incidentToSave = {
              ...incidentTracker.current.initialIncidentData,
              videoBlob: blob
            };
            await saveIncident(incidentToSave);
            logDebug('Incident saved to History with Video');
          }
        } catch (error) {
          setError(`Recording could not be saved: ${error.message}`);
        } finally {
          incidentTracker.current = { activeType: null, firstDetectedAt: 0, lastDetectedAt: 0, isRecording: false, telegramSent: false, initialIncidentData: null };
          setIsRecording(false);
        }
      };
      mediaRecorder.onerror = () => {
        setError('The browser could not record this camera stream.');
        setIsRecording(false);
        incidentTracker.current.isRecording = false;
      };

      recordedChunksRef.current = [];
      mediaRecorder.start(1000); // chunk every second
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      incidentTracker.current.isRecording = true;
      setError(null);
      logDebug(`Started recording incident${mimeType ? ` with ${mimeType}` : ''}`);
    } catch (e) {
      setError(`Recording could not start: ${e.message}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      logDebug('Stopped recording');
    }
  };

  const captureVideoFrame = (sourceVideo = videoRefs.current.get(selectedDeviceId)) => {
    const video = sourceVideo;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6); // compressed image
  };

  const processIncidentState = (incident, sourceVideo) => {
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
          image: captureVideoFrame(sourceVideo),
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

  const detectObjects = async (feed) => {
    const video = videoRefs.current.get(feed.device.deviceId);
    const canvas = canvasRefs.current.get(feed.device.deviceId);
    if (!video || !canvas || !model || video.readyState < 2) return feed;
    try {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const predictions = await model.detect(video);
      const incident = await detectIncident(predictions, canvas, video);
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
      if (feed.device.deviceId === selectedDeviceId) setDetections(predictions);
      processIncidentState(incident, video);
      return { ...feed, predictions };
    } catch (error) {
      console.error(`Object detection error on ${feed.device.label || feed.device.deviceId}:`, error);
      return feed;
    }
  };

  const startDetection = () => {
    if (!model || !cameraFeeds.length) return;
    if (detectionFrameRef.current) {
      cancelAnimationFrame(detectionFrameRef.current);
    }
    const detectFrame = async () => {
      const liveFeeds = cameraFeeds.filter((feed) => feed.stream);
      const updatedFeeds = await Promise.all(liveFeeds.map((feed) => detectObjects(feed)));
      if (updatedFeeds.length) {
        setCameraFeeds((current) => current.map((feed) => updatedFeeds.find((updated) => updated.device.deviceId === feed.device.deviceId) || feed));
      }
      detectionFrameRef.current = requestAnimationFrame(detectFrame);
    };
    detectFrame();
  };

  const hasLiveCameras = cameraFeeds.some((feed) => feed.stream);

  useEffect(() => {
    if (model && cameraFeeds.some((feed) => feed.stream)) {
      startDetection();
    }
    // The loop is restarted only when model availability or live-camera presence changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, hasLiveCameras]);

  useEffect(() => {
    if (isAlertVisible) {
      const timer = setTimeout(() => setIsAlertVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [isAlertVisible]);

  useEffect(() => () => {
    if (detectionFrameRef.current) {
      cancelAnimationFrame(detectionFrameRef.current);
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    videoRefs.current.forEach((video) => {
      if (video.srcObject) {
        video.srcObject.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
      }
    });
    videoRefs.current.clear();
    canvasRefs.current.clear();
    if (lastRecordingUrlRef.current) URL.revokeObjectURL(lastRecordingUrlRef.current);
  }, []);

  const getAlertTitle = (type) => {
    switch (type) {
      case 'fire': return '🔥 Fire Hazard Detected!';
      case 'overcrowd': return '👥 Overcrowding Detected!';
      case 'accident': return '🚨 Potential Accident Detected!';
      case 'object_movement': return '📱 Object Movement Detected!';
      default: return '⚠️ Incident Detected!';
    }
  };

  const detectedTypes = [...new Set(detections.map((detection) => detection.class))];

  return (
    <div className="safety-monitoring-container">
      <div className="monitoring-wrapper">
        {/* ─── HEADER ─── */}
        <header className="monitoring-header">
          <div className="header-content">
            <div className="system-heading">
              <div className="system-brand-mark">✦</div>
              <div>
                <p className="system-kicker">SENTINEL / OPERATIONS</p>
                <h1 className="system-title">Recording workspace</h1>
              </div>
            </div>
            <div className="header-actions">
              <div className="theme-switcher" role="group" aria-label="Appearance mode">
                {["light", "dark", "system"].map((option) => (
                  <button key={option} type="button" className={theme === option ? "selected" : ""} onClick={() => setTheme(option)}>
                    {option === "system" ? "◐" : option === "light" ? "☼" : "◑"} <span>{option}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => navigate('/dashboard')} className="test-btn">▦ Dashboard</button>
              <button onClick={() => navigate('/history')} className="test-btn">📅 History</button>
              <button onClick={() => {               localStorage.removeItem('sentinel_session'); localStorage.removeItem('sentinel_token'); navigate('/'); }} className="test-btn">Sign out</button>
              <div className={`telegram-status ${TELEGRAM_BOT_TOKEN ? 'status-online' : 'status-offline'}`}>
                Telegram: {isTelegramSending ? 'Sending alert...' : TELEGRAM_BOT_TOKEN ? 'Connected' : 'Not Configured'}
              </div>
            </div>
          </div>
          {error && <div className="error-notification">{error}</div>}
        </header>

        <RemoteCameraPanel />

        {/* ─── MAIN LAYOUT ─── */}
        <div className="monitor-layout">
          {/* Video Feed */}
          <div className="video-monitoring-section">
            <div className="feed-toolbar"><div><span className="feed-live-dot" /> LIVE CAMERA FEED <small>• CAM-{selectedDeviceId ? selectedDeviceId.slice(0, 4).toUpperCase() : 'LOCAL'}</small></div><span className="feed-resolution">640 × 480 HD</span></div>
            {/* Recording indicator bar */}
            {isRecording && (
              <div className="recording-bar" onClick={stopRecording}>
                <span className="recording-dot"></span>
                <span style={{color: 'white', fontSize: '0.8rem', fontWeight: 700}}>REC — Click to Stop</span>
              </div>
            )}

            <div className={`camera-wall ${cameraFeeds.length === 1 ? 'single-camera' : ''}`}>
              {cameraFeeds.map((feed) => {
                const deviceId = feed.device.deviceId;
                const isFocused = selectedDeviceId === deviceId;
                return (
                  <button
                    className={`camera-tile ${isFocused ? 'focused' : ''} ${feed.status === 'error' ? 'camera-error' : ''}`}
                    key={deviceId}
                    type="button"
                    onClick={() => setSelectedDeviceId(deviceId)}
                    onDoubleClick={() => videoRefs.current.get(deviceId)?.requestFullscreen?.()}
                  >
                    <div className="camera-tile-header"><strong>{feed.device.label || `Camera ${deviceId.slice(0, 5)}`}</strong><span>{feed.status === 'live' ? 'LIVE' : feed.status === 'error' ? 'UNAVAILABLE' : 'READY'}</span></div>
                    <div className="video-canvas-container">
                      <video ref={(element) => { if (element) videoRefs.current.set(deviceId, element); else videoRefs.current.delete(deviceId); }} className="monitoring-video" autoPlay playsInline muted />
                      <canvas ref={(element) => { if (element) canvasRefs.current.set(deviceId, element); else canvasRefs.current.delete(deviceId); }} className="detection-overlay-canvas" />
                      {feed.status === 'error' && <div className="camera-error-message">Camera unavailable<br /><small>{feed.error}</small></div>}
                    </div>
                    <div className="camera-tile-footer"><span>{feed.predictions.length} detected</span><span>{isFocused ? 'FOCUS VIEW • DOUBLE-CLICK FULLSCREEN' : 'Select to focus'}</span></div>
                  </button>
                );
              })}
              {!cameraFeeds.length && <div className="empty-camera-wall">No cameras detected. Connect a camera and reload this page.</div>}
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
              <span className="side-panel-label">📷 Camera wall</span>
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
                className={`btn-camera ${!devices.length ? 'disabled' : 'active'}`}
                disabled={!devices.length}
              >
                {isLoading ? "Loading AI... Start cameras" : model ? (hasLiveCameras ? "🔄 Restart all cameras" : "▶ Start all cameras") : "▶ Start cameras without AI"}
              </button>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className="btn-camera active"
                disabled={!hasLiveCameras}
              >
                {isRecording ? "⏹ Stop recording" : "● Start recording"}
              </button>
              {lastRecordingUrl && (
                <a className="btn-camera recording-download" href={lastRecordingUrl} download="sentinel-recording.webm">
                  Download last recording
                </a>
              )}
              <small className="camera-help">
                Recording uses the selected focus camera. AI detection continues on every live camera.
              </small>
              {!model && !isLoading && (
                <button onClick={() => { setError(null); setIsLoading(true); setModelLoadAttempt((attempt) => attempt + 1); }} className="retry-model-btn">
                  Retry model download
                </button>
              )}
            </div>
            <div className="side-panel-card insight-card">
              <div className="card-heading"><span className="side-panel-label">Detection insight</span><span className="card-spark">↗</span></div>
              <strong className="insight-value">{detections.length ? `${detections.length} tracked` : 'No objects'}</strong>
              <div className="object-tags">{detectedTypes.length ? detectedTypes.slice(0, 4).map((type) => <span key={type}>{type}</span>) : <span className="muted-tag">Start a camera to scan</span>}</div>
            </div>

            {/* Status Card */}
            <div className="side-panel-card">
              <span className="side-panel-label">Status</span>
              <div className={`status-pill ${hasLiveCameras ? 'live' : 'idle'}`}>
                <span className="status-dot"></span>
                {hasLiveCameras ? `Monitoring ${cameraFeeds.filter((feed) => feed.stream).length} cameras` : 'Idle'}
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