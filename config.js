// Basic site configuration
window.CONFIG = {
  // Local testing: keep relative. On Cloudflare Pages, set to your raw GitHub URL.
  // e.g. "https://raw.githubusercontent.com/elikemnordor/red-carpet-1/main/image-data.json"
  DATA_URL: "image-data.json",

  // Polling interval for new images (ms)
  POLL_INTERVAL_MS: 7000,

  // Slideshow advance interval (ms)
  SLIDE_INTERVAL_MS: 10000,

  // Idle timeout before resuming live autoplay (ms)
  IDLE_TIMEOUT_MS: 45000,

  // Max number of items to keep in memory
  MAX_ITEMS: 500,

  // Live-mode tuning
  // How many of the newest photos to primarily cycle through
  RECENT_WINDOW: 12,
  // Probability (0..1) on each tick to jump to an older random photo
  LIVE_RANDOM_JUMP_PROB: 0.2,

  // New arrivals behavior
  // Wait at least this long after detecting new photos before snapping to newest (ms)
  NEWITEM_SNAP_DELAY_MS: 8000,
  // Ensure snaps to newest are spaced at least this far apart (ms)
  NEWITEM_SNAP_COOLDOWN_MS: 15000,
};
