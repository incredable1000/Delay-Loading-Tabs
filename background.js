const DEFAULT_SETTINGS = {
  enabled: false,
  autoLoadEnabled: false,
  autoLoadIntervalSeconds: 60
};

const STORAGE_KEYS = {
  enabled: "enabled",
  autoLoadEnabled: "autoLoadEnabled",
  autoLoadIntervalSeconds: "autoLoadIntervalSeconds",
  autoLoadIntervalMinutes: "autoLoadIntervalMinutes",
  lazyQueue: "lazyQueue",
  nextAlarmAt: "nextAlarmAt",
  blockedDomains: "blockedDomains"
};

const AUTOLOAD_ALARM = "autoLoadLazyTabs";
const BADGE_COLOR = "#4CAF50";
const MENU_IDS = {
  openLazyLink: "openLazyLink",
  convertTab: "convertTabToLazy"
};

const getLocal = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, resolve));

const setLocal = (items) =>
  new Promise((resolve) => chrome.storage.local.set(items, resolve));

const getTab = (tabId) =>
  new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });

const createTab = (createProperties) =>
  new Promise((resolve) => {
    chrome.tabs.create(createProperties, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });

const updateTab = (tabId, updateProperties) =>
  new Promise((resolve) => {
    chrome.tabs.update(tabId, updateProperties, () => resolve());
  });

const queryTabs = (queryInfo) =>
  new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));

const getAlarm = (name) =>
  new Promise((resolve) => chrome.alarms.get(name, resolve));

const clearAlarm = (name) =>
  new Promise((resolve) => chrome.alarms.clear(name, resolve));

const setNextAlarmAt = (value) =>
  setLocal({ [STORAGE_KEYS.nextAlarmAt]: value });

function formatBadgeText(count) {
  if (!Number.isFinite(count) || count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

function updateBadge(count) {
  chrome.action.setBadgeText({ text: formatBadgeText(count) });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

function normalizeDomain(value) {
  if (!value || typeof value !== "string") return "";
  let trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith(".")) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isDomainBlocked(hostname, blockedDomains) {
  if (!hostname) return false;
  for (const domain of blockedDomains) {
    const normalized = normalizeDomain(domain);
    if (!normalized) continue;
    if (hostname === normalized || hostname.endsWith(`.${normalized}`)) {
      return true;
    }
  }
  return false;
}

async function getBlockedDomains() {
  const result = await getLocal([STORAGE_KEYS.blockedDomains]);
  const domains = Array.isArray(result[STORAGE_KEYS.blockedDomains])
    ? result[STORAGE_KEYS.blockedDomains]
    : [];
  return domains.map(normalizeDomain).filter(Boolean);
}

async function shouldBlockUrl(url) {
  const blockedDomains = await getBlockedDomains();
  const hostname = getHostname(url);
  return isDomainBlocked(hostname, blockedDomains);
}

function normalizeIntervalSeconds(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) {
    return DEFAULT_SETTINGS.autoLoadIntervalSeconds;
  }
  return Math.floor(num);
}

async function getSettings() {
  const result = await getLocal([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.autoLoadEnabled,
    STORAGE_KEYS.autoLoadIntervalSeconds,
    STORAGE_KEYS.autoLoadIntervalMinutes
  ]);

  const enabled =
    typeof result[STORAGE_KEYS.enabled] === "boolean"
      ? result[STORAGE_KEYS.enabled]
      : DEFAULT_SETTINGS.enabled;

  const autoLoadEnabled =
    typeof result[STORAGE_KEYS.autoLoadEnabled] === "boolean"
      ? result[STORAGE_KEYS.autoLoadEnabled]
      : DEFAULT_SETTINGS.autoLoadEnabled;

  let autoLoadIntervalSeconds = Number(
    result[STORAGE_KEYS.autoLoadIntervalSeconds]
  );

  if (!Number.isFinite(autoLoadIntervalSeconds) || autoLoadIntervalSeconds < 1) {
    const legacyMinutes = Number(result[STORAGE_KEYS.autoLoadIntervalMinutes]);
    if (Number.isFinite(legacyMinutes) && legacyMinutes >= 1) {
      autoLoadIntervalSeconds = Math.floor(legacyMinutes) * 60;
    } else {
      autoLoadIntervalSeconds = DEFAULT_SETTINGS.autoLoadIntervalSeconds;
    }
  } else {
    autoLoadIntervalSeconds = Math.floor(autoLoadIntervalSeconds);
  }

  return { enabled, autoLoadEnabled, autoLoadIntervalSeconds };
}

function isCustomTabUrl(url) {
  return (
    typeof url === "string" &&
    url.startsWith(chrome.runtime.getURL("custom_tab.html"))
  );
}

function isLazyCandidateUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildCustomTabUrl(originalUrl) {
  const encoded = encodeURIComponent(originalUrl);
  const ts = Date.now();
  return chrome.runtime.getURL(`custom_tab.html?url=${encoded}&ts=${ts}`);
}

function getOriginalUrlFromCustomTab(customUrl) {
  try {
    if (!isCustomTabUrl(customUrl)) return null;
    const parsed = new URL(customUrl);
    const original = parsed.searchParams.get("url");
    return original || null;
  } catch {
    return null;
  }
}

function getTimestampFromCustomTab(customUrl) {
  try {
    if (!isCustomTabUrl(customUrl)) return 0;
    const parsed = new URL(customUrl);
    const raw = parsed.searchParams.get("ts");
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

async function ensureDefaults() {
  const result = await getLocal([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.autoLoadEnabled,
    STORAGE_KEYS.autoLoadIntervalSeconds,
    STORAGE_KEYS.autoLoadIntervalMinutes,
    STORAGE_KEYS.lazyQueue,
    STORAGE_KEYS.nextAlarmAt,
    STORAGE_KEYS.blockedDomains
  ]);

  const updates = {};

  if (typeof result[STORAGE_KEYS.enabled] !== "boolean") {
    updates[STORAGE_KEYS.enabled] = DEFAULT_SETTINGS.enabled;
  }
  if (typeof result[STORAGE_KEYS.autoLoadEnabled] !== "boolean") {
    updates[STORAGE_KEYS.autoLoadEnabled] = DEFAULT_SETTINGS.autoLoadEnabled;
  }

  let intervalSeconds = Number(result[STORAGE_KEYS.autoLoadIntervalSeconds]);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1) {
    const legacyMinutes = Number(result[STORAGE_KEYS.autoLoadIntervalMinutes]);
    if (Number.isFinite(legacyMinutes) && legacyMinutes >= 1) {
      intervalSeconds = Math.floor(legacyMinutes) * 60;
    } else {
      intervalSeconds = DEFAULT_SETTINGS.autoLoadIntervalSeconds;
    }
    updates[STORAGE_KEYS.autoLoadIntervalSeconds] = intervalSeconds;
  } else {
    const normalized = normalizeIntervalSeconds(intervalSeconds);
    if (normalized !== intervalSeconds) {
      updates[STORAGE_KEYS.autoLoadIntervalSeconds] = normalized;
    }
  }

  if (!Array.isArray(result[STORAGE_KEYS.lazyQueue])) {
    updates[STORAGE_KEYS.lazyQueue] = [];
  }

  if (typeof result[STORAGE_KEYS.nextAlarmAt] !== "number") {
    updates[STORAGE_KEYS.nextAlarmAt] = null;
  }

  if (!Array.isArray(result[STORAGE_KEYS.blockedDomains])) {
    updates[STORAGE_KEYS.blockedDomains] = [];
  }

  if (Object.keys(updates).length > 0) {
    await setLocal(updates);
  }

  const queue = await getLazyQueue();
  updateBadge(queue.length);
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.openLazyLink,
      title: "Open link as lazy tab",
      contexts: ["link"]
    });
    chrome.contextMenus.create({
      id: MENU_IDS.convertTab,
      title: "Convert tab to lazy",
      contexts: ["page"]
    });
  });
}

async function getLazyQueue() {
  const result = await getLocal([STORAGE_KEYS.lazyQueue]);
  const queue = result[STORAGE_KEYS.lazyQueue];
  return Array.isArray(queue) ? queue : [];
}

async function setLazyQueue(queue) {
  await setLocal({ [STORAGE_KEYS.lazyQueue]: queue });
  updateBadge(queue.length);
}

async function enqueueLazyTab(tabId) {
  const queue = await getLazyQueue();
  if (!queue.includes(tabId)) {
    queue.push(tabId);
    await setLazyQueue(queue);
  }
}

async function removeLazyTab(tabId) {
  const queue = await getLazyQueue();
  const next = queue.filter((id) => id !== tabId);
  if (next.length !== queue.length) {
    await setLazyQueue(next);
  }
}

async function rebuildQueueFromTabs() {
  const tabs = await queryTabs({});
  const lazyTabs = tabs.filter((tab) => isCustomTabUrl(tab.url));
  lazyTabs.sort((a, b) => {
    return getTimestampFromCustomTab(a.url) - getTimestampFromCustomTab(b.url);
  });
  const queue = lazyTabs
    .map((tab) => tab.id)
    .filter((id) => typeof id === "number");
  await setLazyQueue(queue);
  return queue;
}

async function popNextLazyTab() {
  let queue = await getLazyQueue();

  while (queue.length > 0) {
    const tabId = queue.shift();
    const tab = await getTab(tabId);
    if (tab && isCustomTabUrl(tab.url)) {
      await setLazyQueue(queue);
      return tab;
    }
  }

  if (queue.length === 0) {
    await setLazyQueue([]);
  }

  return null;
}

async function clearAutoLoadAlarm() {
  await clearAlarm(AUTOLOAD_ALARM);
  await setNextAlarmAt(null);
}

async function ensureAutoLoadAlarm(forceReschedule = false) {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoLoadEnabled) {
    await clearAutoLoadAlarm();
    return;
  }

  const queue = await getLazyQueue();
  if (queue.length === 0) {
    await clearAutoLoadAlarm();
    return;
  }

  const existing = await getAlarm(AUTOLOAD_ALARM);
  if (existing && !forceReschedule) {
    if (typeof existing.scheduledTime === "number") {
      await setNextAlarmAt(existing.scheduledTime);
    }
    return;
  }

  const when = Date.now() + settings.autoLoadIntervalSeconds * 1000;
  await clearAlarm(AUTOLOAD_ALARM);
  chrome.alarms.create(AUTOLOAD_ALARM, { when });
  await setNextAlarmAt(when);
}

async function clearAlarmIfQueueEmpty() {
  const queue = await getLazyQueue();
  if (queue.length === 0) {
    await clearAutoLoadAlarm();
  }
}

async function releaseAllLazyTabs() {
  const tabs = await queryTabs({});
  for (const tab of tabs) {
    if (!tab || !isCustomTabUrl(tab.url)) continue;
    const originalUrl = getOriginalUrlFromCustomTab(tab.url);
    if (originalUrl) {
      await updateTab(tab.id, { url: originalUrl });
    }
  }
  await setLazyQueue([]);
}

async function loadNextLazyTabNow() {
  const tab = await popNextLazyTab();
  if (!tab) {
    await clearAutoLoadAlarm();
    return false;
  }

  const originalUrl = getOriginalUrlFromCustomTab(tab.url);
  if (originalUrl) {
    await updateTab(tab.id, { url: originalUrl });
  }

  await ensureAutoLoadAlarm(true);
  return true;
}

async function openLazyTabForUrl(url, openerTabId, active) {
  const settings = await getSettings();
  const isLazyUrl = isLazyCandidateUrl(url);

  if (!isLazyUrl) {
    return createTab({ url, openerTabId, active });
  }

  if (!settings.enabled) {
    return createTab({ url, openerTabId, active });
  }

  if (await shouldBlockUrl(url)) {
    return createTab({ url, openerTabId, active });
  }

  const customTabUrl = buildCustomTabUrl(url);
  const tab = await createTab({ url: customTabUrl, openerTabId, active });

  if (tab && settings.autoLoadEnabled) {
    await enqueueLazyTab(tab.id);
    await ensureAutoLoadAlarm(false);
  }

  return tab;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults();
  ensureAutoLoadAlarm(true);
  setupContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  setupContextMenus();
  const settings = await getSettings();
  if (settings.enabled && settings.autoLoadEnabled) {
    await rebuildQueueFromTabs();
  }
  await ensureAutoLoadAlarm(true);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "getQueue") {
    getLazyQueue().then((queue) => sendResponse({ queue }));
    return true;
  }

  if (message.type === "loadNextNow") {
    loadNextLazyTabNow()
      .then((loaded) => sendResponse({ loaded }))
      .catch((error) =>
        sendResponse({ loaded: false, error: error?.message || "error" })
      );
    return true;
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info || !info.menuItemId) return;

  if (info.menuItemId === MENU_IDS.openLazyLink) {
    if (!info.linkUrl) return;
    const openerTabId = tab && typeof tab.id === "number" ? tab.id : undefined;
    await openLazyTabForUrl(info.linkUrl, openerTabId, false);
    return;
  }

  if (info.menuItemId === MENU_IDS.convertTab) {
    if (!tab || !tab.url) return;
    if (!isLazyCandidateUrl(tab.url)) return;
    if (isCustomTabUrl(tab.url)) return;

    const settings = await getSettings();
    if (!settings.enabled) return;

    if (await shouldBlockUrl(tab.url)) {
      return;
    }

    const customTabUrl = buildCustomTabUrl(tab.url);
    await updateTab(tab.id, { url: customTabUrl });

    if (settings.autoLoadEnabled) {
      await enqueueLazyTab(tab.id);
      await ensureAutoLoadAlarm(false);
    }
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (!tab.openerTabId || !tab.pendingUrl) return;
  if (!isLazyCandidateUrl(tab.pendingUrl)) return;

  const blockedDomains = await getBlockedDomains();
  const hostname = getHostname(tab.pendingUrl);
  if (isDomainBlocked(hostname, blockedDomains)) return;

  const customTabUrl = buildCustomTabUrl(tab.pendingUrl);
  await updateTab(tab.id, { url: customTabUrl });

  if (settings.autoLoadEnabled) {
    await enqueueLazyTab(tab.id);
    await ensureAutoLoadAlarm(false);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await getTab(activeInfo.tabId);
  if (!tab || !isCustomTabUrl(tab.url)) return;

  const originalUrl = getOriginalUrlFromCustomTab(tab.url);
  if (originalUrl) {
    await updateTab(activeInfo.tabId, { url: originalUrl });
  }
  await removeLazyTab(activeInfo.tabId);
  await clearAlarmIfQueueEmpty();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeLazyTab(tabId);
  await clearAlarmIfQueueEmpty();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.enabled && changes.enabled.newValue === false) {
    await clearAutoLoadAlarm();
    await releaseAllLazyTabs();
    return;
  }

  if (
    changes.autoLoadEnabled ||
    changes.autoLoadIntervalSeconds ||
    changes.enabled
  ) {
    const settings = await getSettings();
    if (settings.enabled && settings.autoLoadEnabled) {
      await rebuildQueueFromTabs();
    }
    await ensureAutoLoadAlarm(true);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTOLOAD_ALARM) return;

  const settings = await getSettings();
  if (!settings.enabled || !settings.autoLoadEnabled) {
    await clearAutoLoadAlarm();
    return;
  }

  const tab = await popNextLazyTab();
  if (!tab) {
    await clearAutoLoadAlarm();
    return;
  }

  const originalUrl = getOriginalUrlFromCustomTab(tab.url);
  if (originalUrl) {
    await updateTab(tab.id, { url: originalUrl });
  }

  await ensureAutoLoadAlarm(true);
});

(async () => {
  await ensureDefaults();
  const settings = await getSettings();
  if (settings.enabled && settings.autoLoadEnabled) {
    await rebuildQueueFromTabs();
  }
  await ensureAutoLoadAlarm(true);
})();
