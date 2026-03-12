document.addEventListener("DOMContentLoaded", function () {
  const enabledInput = document.getElementById("enabled");
  const autoLoadEnabledInput = document.getElementById("autoLoadEnabled");
  const autoLoadIntervalInput = document.getElementById("autoLoadIntervalSeconds");
  const queueCount = document.getElementById("queueCount");
  const queueList = document.getElementById("queueList");
  const queueEmpty = document.getElementById("queueEmpty");
  const loadNextButton = document.getElementById("loadNext");
  const refreshButton = document.getElementById("refreshQueue");

  const QUEUE_PREVIEW_LIMIT = 8;

  function sendMessage(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  function getTabSafe(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(tab);
      });
    });
  }

  function getOriginalUrl(customUrl) {
    if (!customUrl) return null;
    try {
      const parsed = new URL(customUrl);
      return parsed.searchParams.get("url") || null;
    } catch {
      return null;
    }
  }

  function formatUrlLabel(rawUrl) {
    if (!rawUrl) return "Unknown";
    try {
      const parsed = new URL(rawUrl);
      const path = parsed.pathname === "/" ? "" : parsed.pathname;
      return `${parsed.hostname}${path}`;
    } catch {
      return rawUrl;
    }
  }

  async function getQueue() {
    const response = await sendMessage({ type: "getQueue" });
    if (response && Array.isArray(response.queue)) {
      return response.queue;
    }
    return [];
  }

  async function renderQueue() {
    const queue = await getQueue();
    queueCount.textContent = String(queue.length);
    loadNextButton.disabled = queue.length === 0;

    queueList.textContent = "";

    if (queue.length === 0) {
      queueEmpty.style.display = "block";
      return;
    }

    queueEmpty.style.display = "none";

    const fragment = document.createDocumentFragment();
    const previewCount = Math.min(queue.length, QUEUE_PREVIEW_LIMIT);

    for (let i = 0; i < previewCount; i += 1) {
      const tabId = queue[i];
      const tab = await getTabSafe(tabId);
      const item = document.createElement("li");
      item.className = "queue-item";

      if (!tab || !tab.url) {
        item.textContent = `${i + 1}. (tab closed)`;
      } else {
        const originalUrl = getOriginalUrl(tab.url) || tab.url;
        const label = formatUrlLabel(originalUrl);
        item.textContent = `${i + 1}. ${label}`;
      }

      fragment.appendChild(item);
    }

    if (queue.length > QUEUE_PREVIEW_LIMIT) {
      const moreItem = document.createElement("li");
      moreItem.className = "queue-item queue-more";
      moreItem.textContent = `+${queue.length - QUEUE_PREVIEW_LIMIT} more…`;
      fragment.appendChild(moreItem);
    }

    queueList.appendChild(fragment);
  }

  chrome.storage.local.get(
    ["enabled", "autoLoadEnabled", "autoLoadIntervalSeconds"],
    function (result) {
      const enabled =
        typeof result.enabled === "boolean" ? result.enabled : false;
      const autoLoadEnabled =
        typeof result.autoLoadEnabled === "boolean"
          ? result.autoLoadEnabled
          : false;
      const autoLoadIntervalSeconds = Number.isFinite(
        result.autoLoadIntervalSeconds
      )
        ? Math.max(1, Math.floor(result.autoLoadIntervalSeconds))
        : 60;

      enabledInput.checked = enabled;
      autoLoadEnabledInput.checked = autoLoadEnabled;
      autoLoadIntervalInput.value = autoLoadIntervalSeconds;
      autoLoadIntervalInput.disabled = !autoLoadEnabled;
    }
  );

  enabledInput.addEventListener("change", function () {
    chrome.storage.local.set({ enabled: enabledInput.checked });
  });

  autoLoadEnabledInput.addEventListener("change", function () {
    chrome.storage.local.set({ autoLoadEnabled: autoLoadEnabledInput.checked });
    autoLoadIntervalInput.disabled = !autoLoadEnabledInput.checked;
  });

  autoLoadIntervalInput.addEventListener("change", function () {
    let value = parseInt(autoLoadIntervalInput.value, 10);
    if (!Number.isFinite(value) || value < 1) {
      value = 1;
    }
    autoLoadIntervalInput.value = value;
    chrome.storage.local.set({ autoLoadIntervalSeconds: value });
  });

  loadNextButton.addEventListener("click", async function () {
    loadNextButton.disabled = true;
    await sendMessage({ type: "loadNextNow" });
    await renderQueue();
  });

  refreshButton.addEventListener("click", function () {
    renderQueue();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.lazyQueue || changes.enabled || changes.autoLoadEnabled) {
      renderQueue();
    }
  });

  renderQueue();
});
