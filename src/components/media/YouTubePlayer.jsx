import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import './YouTubePlayer.css';

let ytApiLoaded = false;
let ytApiLoading = false;
const ytApiCallbacks = [];

function loadYouTubeApi() {
  if (ytApiLoaded) return Promise.resolve();
  if (ytApiLoading) {
    return new Promise((resolve) => ytApiCallbacks.push(resolve));
  }

  ytApiLoading = true;
  return new Promise((resolve) => {
    ytApiCallbacks.push(resolve);

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      ytApiLoading = false;
      ytApiCallbacks.forEach((cb) => cb());
      ytApiCallbacks.length = 0;
    };
  });
}

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
        onEnd?.();
        return;
      }
      rafRef.current = requestAnimationFrame(check);
    };
    rafRef.current = requestAnimationFrame(check);
  }, [endTime, onEnd]);

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
    width, height, autoPlay, startTime, interactive, onReady, onError, startEndTimeLoop,
  };

  useEffect(() => {
    if (!videoId) return;

    let destroyed = false;
    const {
      width, height, autoPlay, startTime, interactive, onReady, onError, startEndTimeLoop,
    } = setupRef.current;

    loadYouTubeApi().then(() => {
      if (destroyed || !containerRef.current) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: typeof width === 'number' ? width : undefined,
        height,
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

              // Detect autoplay blocked (mobile)
              setTimeout(() => {
                if (destroyed) return;
                const state = event.target.getPlayerState();
                // -1 = unstarted, 5 = cued
                if (state === -1 || state === 5) {
                  setNeedsInteraction(true);
                }
              }, 1000);
            }
          },
          onStateChange: (event) => {
            if (destroyed) return;
            // YT.PlayerState.PLAYING = 1
            if (event.data === 1) {
              setNeedsInteraction(false);
              setupRef.current.startEndTimeLoop();
            }
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
      playerRef.current.seekTo(startTime || 0, true);
      playerRef.current.playVideo();
      setNeedsInteraction(false);
      startEndTimeLoop();
    }
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
    <div className={`yt-player-wrapper ${audioOnly ? 'audio-only' : ''}`}>
      {!isReady && (
        <div className="yt-loading">
          <div className="yt-loading-spinner" />
        </div>
      )}

      {/* The actual YouTube iframe container */}
      <div className="yt-iframe-wrapper" style={audioOnly ? undefined : { width, height }}>
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

      {/* Click-to-play overlay for mobile autoplay block */}
      {needsInteraction && (
        <button className="yt-play-overlay" onClick={handleClickToPlay}>
          <span className="yt-play-icon">&#9654;</span>
          <span>Tap to play</span>
        </button>
      )}
    </div>
  );
});

export default YouTubePlayer;
