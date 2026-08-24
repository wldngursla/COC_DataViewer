/** Pure time-state transitions used by the Graphs playback controls. */

export const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface PlaybackState {
  timeSec: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
}

function clampTime(timeSec: number, durationSec: number): number {
  if (!Number.isFinite(timeSec)) return 0;
  return Math.min(Math.max(timeSec, 0), Math.max(durationSec, 0));
}

export function seekPlayback(
  state: PlaybackState,
  timeSec: number,
  durationSec: number,
): PlaybackState {
  return { ...state, timeSec: clampTime(timeSec, durationSec) };
}

export function setPlaybackPlaying(
  state: PlaybackState,
  isPlaying: boolean,
): PlaybackState {
  return { ...state, isPlaying };
}

export function setPlaybackSpeed(
  state: PlaybackState,
  speed: PlaybackSpeed,
): PlaybackState {
  return { ...state, speed };
}

export function advancePlayback(
  state: PlaybackState,
  realDeltaSec: number,
  durationSec: number,
): PlaybackState {
  if (!state.isPlaying || !Number.isFinite(realDeltaSec) || realDeltaSec <= 0) {
    return state;
  }

  const timeSec = clampTime(state.timeSec + realDeltaSec * state.speed, durationSec);
  return {
    ...state,
    timeSec,
    isPlaying: timeSec < Math.max(durationSec, 0),
  };
}
