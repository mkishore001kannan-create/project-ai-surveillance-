const DB_NAME = 'SafetyMonitoringDB';
const STORE_NAME = 'incidents';
const DB_VERSION = 1;

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject('IndexedDB error: ' + event.target.error);

    request.onsuccess = (event) => resolve(event.target.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
};

export const saveIncident = async (incident) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Ensure it has a unique ID
    const incidentData = {
      ...incident,
      id: incident.id || Date.now().toString(),
      timestampStr: new Date(incident.timestamp).toLocaleString()
    };

    const request = store.add(incidentData);
    request.onsuccess = () => resolve(incidentData);
    request.onerror = (event) => reject(event.target.error);
  });
};

export const getAllIncidents = async () => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    
    const request = index.getAll();
    request.onsuccess = () => {
      // Sort descending (newest first)
      const results = request.result.sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = (event) => reject(event.target.error);
  });
};

export const cleanOldIncidents = async (days = 10) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.timestamp < cutoffTime) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = (event) => reject(event.target.error);
  });
};
