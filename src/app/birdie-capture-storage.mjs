const DEFAULT_DATABASE = "(default)";

export class BirdieCaptureStorageError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = "BirdieCaptureStorageError";
    this.code = code;
    this.status = status;
  }
}

function firestoreValue(value) {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  return { stringValue: String(value) };
}

function fieldsFor(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, firestoreValue(value)]));
}

function fromFirestoreValue(value) {
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.integerValue !== undefined) return Number(value.integerValue);
  if (value?.booleanValue !== undefined) return value.booleanValue;
  return null;
}

function recordFromDocument(document) {
  const fields = document?.fields || {};
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

function documentURL({ projectID, database, collection, captureID }) {
  return [
    "https://firestore.googleapis.com/v1/projects",
    encodeURIComponent(projectID),
    "databases",
    encodeURIComponent(database),
    "documents",
    encodeURIComponent(collection),
    encodeURIComponent(captureID)
  ].join("/");
}

async function metadataAccessToken(fetchImpl) {
  const response = await fetchImpl(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!response.ok) throw new BirdieCaptureStorageError("AUTH_UNAVAILABLE", "Google runtime credentials are unavailable");
  const body = await response.json();
  if (!body?.access_token) throw new BirdieCaptureStorageError("AUTH_UNAVAILABLE", "Google runtime token is missing");
  return body.access_token;
}

export function createFirestoreCaptureStorage({
  projectID,
  database = DEFAULT_DATABASE,
  collection = "captures",
  fetchImpl = globalThis.fetch,
  accessTokenProvider = () => metadataAccessToken(fetchImpl)
} = {}) {
  if (!projectID || typeof fetchImpl !== "function") return null;
  const base = { projectID, database, collection };

  async function request(captureID, options = {}) {
    const token = await accessTokenProvider();
    const response = await fetchImpl(documentURL({ ...base, captureID }), {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    return response;
  }

  return {
    async findByCaptureID(captureID) {
      const response = await request(captureID);
      if (response.status === 404) return null;
      if (!response.ok) throw new BirdieCaptureStorageError("STORAGE_READ_FAILED", `Firestore read failed (${response.status})`);
      return recordFromDocument(await response.json());
    },
    async create(record) {
      const response = await request(record.captureID, {
        method: "PATCH",
        body: JSON.stringify({
          fields: fieldsFor(record),
          currentDocument: { exists: false }
        })
      });
      if (response.status === 409) throw Object.assign(new Error("already exists"), { code: "already_exists" });
      if (!response.ok) throw new BirdieCaptureStorageError("STORAGE_WRITE_FAILED", `Firestore write failed (${response.status})`);
      return recordFromDocument(await response.json());
    },
    async delete(captureID) {
      const response = await request(captureID, { method: "DELETE" });
      if (response.status === 404) return;
      if (!response.ok) throw new BirdieCaptureStorageError("STORAGE_DELETE_FAILED", `Firestore delete failed (${response.status})`);
    }
  };
}
