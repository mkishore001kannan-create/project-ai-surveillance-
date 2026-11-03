/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from 'react';
import { apiRequest, signalingUrl } from '../utils/api';

const RemoteCameraViewer = ({ camera, onError }) => {
  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const socketRef = useRef(null);
  const [status, setStatus] = useState('Connecting');

  useEffect(() => {
    let active = true;
    const socket = new WebSocket(signalingUrl(camera.id));
    const peer = new RTCPeerConnection();
    socketRef.current = socket;
    peerRef.current = peer;
    peer.ontrack = (event) => {
      if (videoRef.current) videoRef.current.srcObject = event.streams[0];
      setStatus('Live');
    };
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ice', candidate }));
    };
    socket.onopen = () => {
      setStatus('Waiting for publisher');
      socket.send(JSON.stringify({ type: 'ready' }));
    };
    socket.onmessage = async ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.senderId === undefined) return;
        if (message.type === 'offer') {
          await peer.setRemoteDescription(message);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
        } else if (message.type === 'ice' && message.candidate) {
          await peer.addIceCandidate(message.candidate);
        }
      } catch (error) {
        if (active) { setStatus('Connection error'); onError?.(error.message); }
      }
    };
    socket.onerror = () => { if (active) { setStatus('Unavailable'); onError?.('Remote signaling connection failed.'); } };
    return () => {
      active = false;
      socket.close();
      peer.close();
    };
  }, [camera.id, onError]);

  return <div className="remote-camera-tile"><video ref={videoRef} autoPlay playsInline muted /><div className="remote-camera-meta"><strong>{camera.name}</strong><span>{status}</span></div></div>;
};

const RemoteCameraPublisher = ({ cameraId }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const peerRef = useRef(null);
  const socketRef = useRef(null);
  const [camera, setCamera] = useState(null);
  const [status, setStatus] = useState('Loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const start = async () => {
      try {
        const { cameras } = await apiRequest('/api/cameras');
        const registeredCamera = cameras.find((item) => item.id === cameraId);
        if (!registeredCamera) throw new Error('Registered camera not found or access denied.');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!active) return;
        setCamera(registeredCamera);
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        const socket = new WebSocket(signalingUrl(cameraId));
        const peer = new RTCPeerConnection();
        socketRef.current = socket;
        peerRef.current = peer;
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
        peer.onicecandidate = ({ candidate }) => {
          if (candidate && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ice', candidate }));
        };
        socket.onopen = () => setStatus('Waiting for viewer');
        socket.onmessage = async ({ data }) => {
          try {
            const message = JSON.parse(data);
            if (message.type === 'ready') {
              const offer = await peer.createOffer();
              await peer.setLocalDescription(offer);
              socket.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
              setStatus('Offer sent');
            } else if (message.type === 'answer') {
              await peer.setRemoteDescription({ type: 'answer', sdp: message.sdp });
              setStatus('Connected');
            } else if (message.type === 'ice' && message.candidate) await peer.addIceCandidate(message.candidate);
          } catch (messageError) { if (active) setError(messageError.message); }
        };
        socket.onerror = () => { if (active) { setStatus('Unavailable'); setError('Signaling connection failed.'); } };
      } catch (startError) { if (active) { setStatus('Failed'); setError(startError.message || 'Unable to start publisher.'); } }
    };
    start();
    return () => {
      active = false;
      socketRef.current?.close();
      peerRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraId]);

  return <div className="publisher-page"><p className="section-kicker">REMOTE CAMERA PUBLISHER</p><h2>{camera?.name || 'Camera publisher'}</h2><p className="camera-note">Keep this page open on the device with the camera. A viewer must connect before video is sent.</p><video ref={videoRef} autoPlay muted playsInline className="publisher-preview" /><p className="camera-state">{status}</p>{error && <p className="error-notification">{error}</p>}</div>;
};

const RemoteCameraPanel = () => {
  const [cameras, setCameras] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    apiRequest('/api/cameras').then(({ cameras: registered }) => setCameras(registered.filter((camera) => camera.source_type === 'publisher'))).catch((loadError) => setError(loadError.message));
  }, []);
  if (!cameras.length && !error) return null;
  return <section className="remote-camera-panel"><div className="activity-heading"><div><p className="section-kicker">REMOTE PUBLISHERS</p><h3>Registered remote cameras</h3></div><span className="camera-state">WebRTC only</span></div><p className="camera-note">Remote video appears only while a publisher page is open for the camera. Local camera wall below is unchanged.</p>{error ? <p className="error-notification">{error}</p> : <div className="remote-camera-grid">{cameras.map((camera) => <RemoteCameraViewer key={camera.id} camera={camera} onError={setError} />)}</div>}</section>;
};

export { RemoteCameraPublisher, RemoteCameraViewer, RemoteCameraPanel };
