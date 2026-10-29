/* The YouTube IFrame API, loaded once for the whole app: the clip player and
   the watch-along page both wait on the same script. */

let ytApiLoaded = false;
let ytApiLoading = false;
const ytApiCallbacks = [];

export function loadYouTubeApi() {
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
