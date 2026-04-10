export interface Playlist {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  songIds: string[];
  version: number;          // optimistic concurrency lock
  isPublic: boolean;
  vectorId: string | null;  // mean of song vectors
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlaylistDTO {
  name: string;
  description?: string;
  songIds?: string[];
  isPublic?: boolean;
}

export interface UpdatePlaylistDTO {
  name?: string;
  description?: string;
  songIds?: string[];
  isPublic?: boolean;
  version: number;          // REQUIRED — used for optimistic lock check
}

export interface PlaylistConflictError {
  type: "CONFLICT";
  message: string;
  currentVersion: number;
}
