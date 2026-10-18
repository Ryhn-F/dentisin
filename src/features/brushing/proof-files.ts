// File-system side of brushing proof videos (expo-file-system, SDK 57 object API).
//
// expo-camera writes the clip to the app's cache; before anything is sent it is moved to an
// app-private documents folder (never the gallery or media library), one folder per signed-in
// user: <documents>/brushing-proofs/<user_id>/<proof_id>.mp4|.mov. The cache can be cleared by
// the OS, the documents folder survives restarts until the upload is done.
//
// Uploads stream the file natively (File.createUploadTask, binary body) with progress events, so
// the video is never read into a JS string or base64. Nothing here logs; URIs stay in memory and
// in the encrypted queue.

import { Directory, File, Paths, UploadType } from 'expo-file-system';

export const PROOF_DIR_NAME = 'brushing-proofs';

export type UploadResponse = { status: number; body: string };

export type UploadHandle = {
  /** Resolves for every HTTP answer (any status); rejects on network failure or cancel. */
  promise: Promise<UploadResponse>;
  cancel: () => void;
};

/** What the upload queue needs from the file system (injectable for tests). */
export type ProofFiles = {
  /** URI of the destination file for a proof of `userId`; creates the folder. Throws when it cannot. */
  destination: (userId: string, fileName: string) => string;
  /** Size in bytes, or null when the file does not exist (or cannot be read). */
  size: (uri: string) => number | null;
  /** Moves a file (cache -> documents). Resolves false when it failed. */
  move: (fromUri: string, toUri: string) => Promise<boolean>;
  /** Deletes a file; missing files are fine. Never throws. */
  remove: (uri: string) => void;
  /** File URIs in a user's proof folder (empty when the folder does not exist). */
  list: (userId: string) => string[];
  /** Deletes a user's whole proof folder (account deletion). Never throws. */
  removeAll: (userId: string) => void;
  upload: (
    uri: string,
    url: string,
    options: { headers: Record<string, string>; mimeType: string; onProgress: (sent: number, total: number) => void },
  ) => UploadHandle;
};

function userDir(userId: string): Directory {
  return new Directory(Paths.document, PROOF_DIR_NAME, userId);
}

export const expoProofFiles: ProofFiles = {
  destination(userId, fileName) {
    const dir = userDir(userId);
    dir.create({ intermediates: true, idempotent: true });
    return new File(dir, fileName).uri;
  },

  size(uri) {
    try {
      const file = new File(uri);
      if (!file.exists) return null;
      const size = file.size;
      return typeof size === 'number' && Number.isFinite(size) ? size : null;
    } catch {
      return null;
    }
  },

  async move(fromUri, toUri) {
    try {
      const target = new File(toUri);
      if (target.exists) target.delete();
      await new File(fromUri).move(target);
      return true;
    } catch {
      return false;
    }
  },

  remove(uri) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Already gone or not ours: nothing else to do.
    }
  },

  list(userId) {
    try {
      const dir = userDir(userId);
      if (!dir.exists) return [];
      return dir
        .list()
        .filter((entry): entry is File => entry instanceof File)
        .map((f) => f.uri);
    } catch {
      return [];
    }
  },

  removeAll(userId) {
    try {
      const dir = userDir(userId);
      if (dir.exists) dir.delete();
    } catch {
      // Best effort.
    }
  },

  upload(uri, url, { headers, mimeType, onProgress }) {
    const task = new File(uri).createUploadTask(url, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      mimeType,
      onProgress: ({ bytesSent, totalBytes }) => onProgress(bytesSent, totalBytes),
    });
    return {
      promise: task.uploadAsync().then((res) => ({ status: res.status, body: typeof res.body === 'string' ? res.body : '' })),
      cancel: () => {
        try {
          task.cancel();
        } catch {
          // Finished already.
        }
      },
    };
  },
};
