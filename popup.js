document.addEventListener("DOMContentLoaded", function () {
  const enabledInput = document.getElementById("enabled");
  const autoLoadEnabledInput = document.getElementById("autoLoadEnabled");
  const autoLoadIntervalInput = document.getElementById("autoLoadIntervalSeconds");
  const groupLazyTabsInput = document.getElementById("groupLazyTabsEnabled");
  const queueCount = document.getElementById("queueCount");
  const queueList = document.getElementById("queueList");
  const queueEmpty = document.getElementById("queueEmpty");
  const loadNextButton = document.getElementById("loadNext");
  const refreshButton = document.getElementById("refreshQueue");
  const blockedDomainsInput = document.getElementById("blockedDomains");
  const openShortcutsButton = document.getElementById("openShortcuts");

  const QUEUE_PREVIEW_LIMIT = 8;
  let blockedSaveTimer = null;

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

  function normalizeDomain(value) {
    if (!value) return "";
    let trimmed = value.trim().toLowerCase();
    if (!trimmed) return "";
    if (trimmed.startsWith(".")) {
      trimmed = trimmed.slice(1);
    }
    if (!trimmed) return "";
    try {
      if (!trimmed.includes("://")) {
        return new URL(`https://${trimmed}`).hostname.toLowerCase();
      }
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function parseDomainList(raw) {
    const parts = raw.split(/[\n,;]+/);
    const set = new Set();
    for (const part of parts) {
      const normalized = normalizeDomain(part);
      if (normalized) {
        set.add(normalized);
      }
    }
    return Array.from(set);
  }

  function updateBlockedDomainsField(domains) {
    blockedDomainsInput.value = domains.join("\n");
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
      moreItem.textContent = `+${queue.length - QUEUE_PREVIEW_LIMIT} more...`;
      fragment.appendChild(moreItem);
    }

    queueList.appendChild(fragment);
  }

  chrome.storage.local.get(
    [
      "enabled",
      "autoLoadEnabled",
      "autoLoadIntervalSeconds",
      "groupLazyTabsEnabled",
      "blockedDomains"
    ],
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
      const groupLazyTabsEnabled =
        typeof result.groupLazyTabsEnabled === "boolean"
          ? result.groupLazyTabsEnabled
          : false;
      const blockedDomains = Array.isArray(result.blockedDomains)
        ? result.blockedDomains
        : [];

      enabledInput.checked = enabled;
      autoLoadEnabledInput.checked = autoLoadEnabled;
      autoLoadIntervalInput.value = autoLoadIntervalSeconds;
      autoLoadIntervalInput.disabled = !autoLoadEnabled;
      groupLazyTabsInput.checked = groupLazyTabsEnabled;
      updateBlockedDomainsField(blockedDomains);
    }
  );

  enabledInput.addEventListener("change", function () {
    chrome.storage.local.set({ enabled: enabledInput.checked });
  });

  autoLoadEnabledInput.addEventListener("change", function () {
    chrome.storage.local.set({ autoLoadEnabled: autoLoadEnabledInput.checked });
    autoLoadIntervalInput.disabled = !autoLoadEnabledInput.checked;
  });

  groupLazyTabsInput.addEventListener("change", function () {
    chrome.storage.local.set({
      groupLazyTabsEnabled: groupLazyTabsInput.checked
    });
  });

  autoLoadIntervalInput.addEventListener("change", function () {
    let value = parseInt(autoLoadIntervalInput.value, 10);
    if (!Number.isFinite(value) || value < 1) {
      value = 1;
    }
    autoLoadIntervalInput.value = value;
    chrome.storage.local.set({ autoLoadIntervalSeconds: value });
  });

  blockedDomainsInput.addEventListener("input", function () {
    if (blockedSaveTimer) {
      clearTimeout(blockedSaveTimer);
    }
    blockedSaveTimer = setTimeout(() => {
      const domains = parseDomainList(blockedDomainsInput.value);
      chrome.storage.local.set({ blockedDomains: domains });
    }, 500);
  });

  blockedDomainsInput.addEventListener("blur", function () {
    const domains = parseDomainList(blockedDomainsInput.value);
    updateBlockedDomainsField(domains);
    chrome.storage.local.set({ blockedDomains: domains });
  });

  loadNextButton.addEventListener("click", async function () {
    loadNextButton.disabled = true;
    await sendMessage({ type: "loadNextNow" });
    await renderQueue();
  });

  refreshButton.addEventListener("click", function () {
    renderQueue();
  });

  if (openShortcutsButton) {
    openShortcutsButton.addEventListener("click", function () {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.lazyQueue || changes.enabled || changes.autoLoadEnabled) {
      renderQueue();
    }
    if (
      changes.groupLazyTabsEnabled &&
      typeof changes.groupLazyTabsEnabled.newValue === "boolean"
    ) {
      groupLazyTabsInput.checked = changes.groupLazyTabsEnabled.newValue;
    }
    if (changes.blockedDomains && document.activeElement !== blockedDomainsInput) {
      const next = Array.isArray(changes.blockedDomains.newValue)
        ? changes.blockedDomains.newValue
        : [];
      updateBlockedDomainsField(next);
    }
  });

  renderQueue();
});
