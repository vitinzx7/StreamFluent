/** Player time values are always seconds. */
export interface PlayerSnapshot {
  video: HTMLVideoElement | null;
  /** Changes when the episode URL, media source or selected video changes. */
  sessionKey: string;
  currentTime: number;
  paused: boolean;
  playbackRate: number;
  tracks: TextTrack[];
  status: string;
}
