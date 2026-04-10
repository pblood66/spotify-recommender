export interface User {
  id: string;
  spotifyId: string;
  displayName: string;
  email: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatedUser {
  id: string;
  spotifyId: string;
  displayName: string;
  email: string;
}

export interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: "Bearer";
  scope: string;
}

export interface JwtPayload {
  sub: string;          // internal user UUID
  spotifyId: string;
  email: string;
  iat: number;
  exp: number;
}
