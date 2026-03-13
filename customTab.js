const url = new URLSearchParams(window.location.search).get("url");
const urlDisplay = document.getElementById("urlDisplay");
const remainingDisplay = document.getElementById("remainingTime");

urlDisplay.textContent = url || "No URL available";

let currentTabId = null;

const baseTitle = "Lazy Tab";
const hostLabel = (() => {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();

function setTitle(stateLabel) {
  const parts = [];
  if (stateLabel) parts.push(stateLabel);
  parts.push(baseTitle);
  if (hostLabel) parts.push(hostLabel);
  document.title = parts.join(" - ");
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes <= 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

function setRemainingText(text) {
  remainingDisplay.textContent = text;
}

function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function refreshRemaining() {
  const result = await getLocal([
    "autoLoadEnabled",
    "autoLoadIntervalSeconds",
    "lazyQueue",
    "nextAlarmAt"
  ]);

  const autoLoadEnabled =
    typeof result.autoLoadEnabled === "boolean" ? result.autoLoadEnabled : false;
  const intervalSeconds = Number.isFinite(result.autoLoadIntervalSeconds)
    ? Math.max(1, Math.floor(result.autoLoadIntervalSeconds))
    : 60;
  const queue = Array.isArray(result.lazyQueue) ? result.lazyQueue : [];
  const nextAlarmAt =
    typeof result.nextAlarmAt === "number" ? result.nextAlarmAt : null;

  if (!autoLoadEnabled) {
    setRemainingText("Auto-load is off. This tab loads when activated.");
    setTitle("Waiting");
    return;
  }

  if (currentTabId === null) {
    setRemainingText("Auto-load scheduled.");
    setTitle("Scheduled");
    return;
  }

  const position = queue.indexOf(currentTabId);
  if (position === -1) {
    setRemainingText("This tab loads when activated.");
    setTitle("Waiting");
    return;
  }

  if (!nextAlarmAt) {
    setRemainingText("Auto-load scheduled soon.");
    setTitle("Scheduled");
    return;
  }

  const remainingMs =
    nextAlarmAt + position * intervalSeconds * 1000 - Date.now();

  if (remainingMs <= 0) {
    setRemainingText("Auto-loading soon...");
    setTitle("Loading");
    return;
  }

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const remainingLabel = formatDuration(remainingSeconds);
  setRemainingText(`Auto-load in ${remainingLabel}`);
  setTitle(remainingLabel);
}

chrome.tabs.getCurrent((tab) => {
  currentTabId = tab && typeof tab.id === "number" ? tab.id : null;
  refreshRemaining();
});

const intervalId = setInterval(refreshRemaining, 1000);

window.addEventListener("beforeunload", () => {
  clearInterval(intervalId);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (
    changes.enabled ||
    changes.autoLoadEnabled ||
    changes.autoLoadIntervalSeconds ||
    changes.lazyQueue ||
    changes.nextAlarmAt
  ) {
    refreshRemaining();
  }
});
