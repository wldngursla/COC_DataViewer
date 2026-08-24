import { describe, expect, it } from 'vitest';
import {
  advancePlayback,
  seekPlayback,
  setPlaybackPlaying,
  setPlaybackSpeed,
  type PlaybackState,
} from '../playback';

const initial = (): PlaybackState => ({ timeSec: 10, isPlaying: true, speed: 1 });

describe('playback time transitions', () => {
  it('advances at 1x using real elapsed time', () => {
    expect(advancePlayback(initial(), 0.25, 60).timeSec).toBeCloseTo(10.25, 9);
  });

  it('does not advance while paused', () => {
    const paused = setPlaybackPlaying(initial(), false);
    expect(advancePlayback(paused, 2, 60)).toEqual(paused);
  });

  it('applies the selected playback speed', () => {
    const fast = setPlaybackSpeed(initial(), 2);
    expect(advancePlayback(fast, 0.5, 60).timeSec).toBe(11);
  });

  it('clamps to duration and stops at the end', () => {
    expect(advancePlayback(initial(), 100, 60)).toMatchObject({
      timeSec: 60,
      isPlaying: false,
    });
  });

  it('seeks within the run and clamps out-of-range input', () => {
    expect(seekPlayback(initial(), 25.5, 60).timeSec).toBe(25.5);
    expect(seekPlayback(initial(), -5, 60).timeSec).toBe(0);
    expect(seekPlayback(initial(), 70, 60).timeSec).toBe(60);
  });
});
