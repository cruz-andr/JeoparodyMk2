import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { loadYouTubeApi } from './youtubeApi';
import './YouTubePlayer.css';

const YouTubePlayer = forwardRef(function YouTubePlayer(
  {
    videoId,
    startTime = 0,
    endTime = null,
    autoPlay = false,
    audioOnly = false,
    interactive = false, // true = host can click iframe; false = glass shield blocks clicks
    width = '100%',
    height = 300,
    // Size to the parent's width at 16:9 instead of width by height.
    fill = false,
    onReady,
    onEnd,
    onError,
  },
  ref
) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const rafRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  /* Playing, but muted, because the browser would not let it start with
     sound: the picture goes on and a tap brings the sound back. */
  const [mutedFallback, setMutedFallback] = useState(false);
  const playedRef = useRef(false);

  // Expose play/pause/replay to parent
  useImperativeHandle(ref, () => ({
    play: () => {
      if (playerRef.current?.playVideo) {
        playerRef.current.playVideo();
      }
    },
    pause: () => {
      if (playerRef.current?.pauseVideo) {
        playerRef.current.pauseVideo();
      }
    },
    replay: () => {
      if (playerRef.current?.seekTo) {
        // A tap, so the sound is allowed back.
        playerRef.current.unMute?.();
        setMutedFallback(false);
        playerRef.current.seekTo(startTime || 0, true);
        playerRef.current.playVideo();
        startEndTimeLoop();
      }
    },
  }));

  const startEndTimeLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (endTime == null) return;

    const check = () => {
      if (!playerRef.current?.getCurrentTime) return;
      const currentTime = playerRef.current.getCurrentTime();
      if (currentTime >= endTime) {
        playerRef.current.pauseVideo();
        setupRef.current.onEnd?.();
        return;
      }
      rafRef.current = requestAnimationFrame(check);
    };
    rafRef.current = requestAnimationFrame(check);
  }, [endTime]);

  // Listen for synced host media controls via custom DOM event
  useEffect(() => {
    const handleMediaControl = (e) => {
      const { action } = e.detail;
      if (!playerRef.current) return;
      if (action === 'play') playerRef.current.playVideo?.();
      else if (action === 'pause') playerRef.current.pauseVideo?.();
      else if (action === 'replay') {
        playerRef.current.seekTo?.(startTime || 0, true);
        playerRef.current.playVideo?.();
        startEndTimeLoop();
      }
    };
    window.addEventListener('media-control', handleMediaControl);
    return () => window.removeEventListener('media-control', handleMediaControl);
  }, [startTime, startEndTimeLoop]);

  // The player is deliberately built only when the video changes — rebuilding it
  // on any other prop change would restart playback mid-clue. These values are
  // read once at construction, so they live in a ref rather than the dep list.
  const setupRef = useRef(null);
  setupRef.current = {
    width, height, fill, autoPlay, audioOnly, startTime, interactive, onReady, onError, onEnd, startEndTimeLoop,
  };

  useEffect(() => {
    if (!videoId) return;

    let destroyed = false;
    const {
      width, height, fill, autoPlay, audioOnly, startTime, interactive, onReady, onError, startEndTimeLoop,
    } = setupRef.current;
    playedRef.current = false;

    loadYouTubeApi().then(() => {
      if (destroyed || !containerRef.current) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: fill ? '100%' : (typeof width === 'number' ? width : undefined),
        height: fill ? '100%' : height,
        playerVars: {
          autoplay: autoPlay ? 1 : 0,
          start: Math.floor(startTime || 0),
          controls: interactive ? 1 : 0,
          disablekb: interactive ? 0 : 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (event) => {
            if (destroyed) return;
            setIsReady(true);
            onReady?.();

            if (autoPlay) {
              event.target.seekTo(startTime || 0, true);
              event.target.playVideo();
              startEndTimeLoop();

              /* A browser that will not start a clip with sound (Safari, a
                 phone, a tab nobody has tapped) leaves it sitting buffering
                 or paused, not "unstarted", so a single look at the state a
                 second in missed it and the clip sat still until Replay.
                 Whether it ever reached playing is what counts. Not yet, so
                 play it muted, which every browser allows; and only if even
                 that will not go, ask for a tap. A sound clue has nothing to
                 show muted, so it asks straight away. */
              setTimeout(() => {
                if (destroyed || playedRef.current) return;
                if (audioOnly) {
                  setNeedsInteraction(true);
                  return;
                }
                event.target.mute();
                event.target.seekTo(startTime || 0, true);
                event.target.playVideo();
                setMutedFallback(true);
                setTimeout(() => {
                  if (destroyed || playedRef.current) return;
                  setMutedFallback(false);
                  setNeedsInteraction(true);
                }, 1500);
              }, 2000);
            }
          },
          onStateChange: (event) => {
            if (destroyed) return;
            // YT.PlayerState.PLAYING = 1
            if (event.data === 1) {
              playedRef.current = true;
              setNeedsInteraction(false);
              setupRef.current.startEndTimeLoop();
            }
            // A clip with no end of its own ends with the video.
            if (event.data === 0) setupRef.current.onEnd?.();
          },
          onError: (event) => {
            if (destroyed) return;
            setHasError(true);
            onError?.(event.data);
          },
        },
      });
    });

    return () => {
      destroyed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (playerRef.current?.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId]); // Only recreate player when videoId changes

  const handleClickToPlay = () => {
    if (playerRef.current?.seekTo) {
      playerRef.current.unMute?.();
      playerRef.current.seekTo(startTime || 0, true);
      playerRef.current.playVideo();
      setNeedsInteraction(false);
      setMutedFallback(false);
      startEndTimeLoop();
    }
  };

  // The sound back, from the start of the clip, now there has been a tap.
  const handleUnmute = () => {
    if (!playerRef.current) return;
    playerRef.current.unMute?.();
    playerRef.current.seekTo?.(startTime || 0, true);
    playerRef.current.playVideo?.();
    setMutedFallback(false);
    startEndTimeLoop();
  };

  if (hasError) {
    return (
      <div className="yt-error">
        <span className="yt-error-icon">!</span>
        <span>Video unavailable</span>
      </div>
    );
  }

  return (
    <div className={`yt-player-wrapper ${audioOnly ? 'audio-only' : ''} ${fill ? 'yt-fill' : ''}`}>
      {!isReady && (
        <div className="yt-loading">
          <div className="yt-loading-spinner" />
        </div>
      )}

      {/* The actual YouTube iframe container */}
      <div className="yt-iframe-wrapper" style={audioOnly || fill ? undefined : { width, height }}>
        <div
          ref={containerRef}
          className={`yt-iframe-container ${audioOnly ? 'yt-hidden' : ''}`}
        />
        {/* Glass shield: blocks player clicks from reaching the iframe */}
        {!interactive && !audioOnly && <div className="yt-shield" />}
      </div>

      {/* Audio-only placeholder */}
      {audioOnly && isReady && (
        <div className="yt-audio-placeholder">
          <span className="yt-audio-icon">&#9835;</span>
          <span>Audio Clue</span>
        </div>
      )}

      {mutedFallback && !needsInteraction && (
        <button type="button" className="yt-unmute" onClick={handleUnmute}>
          Tap for sound
        </button>
      )}

      {/* Click-to-play overlay for mobile autoplay block */}
      {needsInteraction && (
        <button className="yt-play-overlay" onClick={handleClickToPlay}>
          {/* Drawn, not the ▶ character, which phones show as a colour emoji. */}
          <span className="yt-play-icon"><svg viewBox="0 0 10 12" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M0 0L10 6L0 12Z" /></svg></span>
          <span>Tap to play</span>
        </button>
      )}
    </div>
  );
});

export default YouTubePlayer;
