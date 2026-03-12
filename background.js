const DEFAULT_SETTINGS = {
  enabled: false,
  autoLoadEnabled: false,
  autoLoadIntervalSeconds: 60,
  groupLazyTabsEnabled: false
};

const STORAGE_KEYS = {
  enabled: "enabled",
  autoLoadEnabled: "autoLoadEnabled",
  autoLoadIntervalSeconds: "autoLoadIntervalSeconds",
  autoLoadIntervalMinutes: "autoLoadIntervalMinutes",
  lazyQueue: "lazyQueue",
  nextAlarmAt: "nextAlarmAt",
  blockedDomains: "blockedDomains",
  groupLazyTabsEnabled: "groupLazyTabsEnabled"
};

const AUTOLOAD_ALARM = "autoLoadLazyTabs";
const BADGE_COLOR = "#4CAF50";
const OFFSCREEN_URL = "offscreen.html";
const LAZY_GROUP_TITLE = "Lazy Tabs";
const LAZY_GROUP_COLOR = "green";
const MENU_IDS = {
  openLazyLink: "openLazyLink",
  convertTab: "convertTabToLazy"
};

const lazyGroupByWindow = new Map();

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

const getActiveTabInWindow = async () => {
  const tabs = await queryTabs({ active: true, currentWindow: true });
  return tabs && tabs.length > 0 ? tabs[0] : null;
};

const groupTab = (tabId, groupId, windowId) =>
  new Promise((resolve) => {
    const options = typeof groupId === "number"
      ? { groupId, tabIds: [tabId] }
      : { tabIds: [tabId], createProperties: { windowId } };
    chrome.tabs.group(options, (resultId) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(resultId);
    });
  });

const ungroupTab = (tabId) =>
  new Promise((resolve) => {
    chrome.tabs.ungroup([tabId], () => resolve());
  });

const queryTabGroups = (queryInfo) =>
  new Promise((resolve) => chrome.tabGroups.query(queryInfo, resolve));

const getTabGroup = (groupId) =>
  new Promise((resolve) => {
    chrome.tabGroups.get(groupId, (group) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(group);
    });
  });

const updateTabGroup = (groupId, properties) =>
  new Promise((resolve) => {
    chrome.tabGroups.update(groupId, properties, () => resolve());
  });

const getAlarm = (name) =>
  new Promise((resolve) => chrome.alarms.get(name, resolve));

const clearAlarm = (name) =>
  new Promise((resolve) => chrome.alarms.clear(name, resolve));

const setNextAlarmAt = (value) =>
  setLocal({ [STORAGE_KEYS.nextAlarmAt]: value });

async function getNextAlarmAt() {
  const result = await getLocal([STORAGE_KEYS.nextAlarmAt]);
  const value = result[STORAGE_KEYS.nextAlarmAt];
  return typeof value === "number" ? value : null;
}

function supportsOffscreen() {
  return Boolean(chrome.offscreen && chrome.offscreen.createDocument);
}

function supportsTabGroups() {
  return Boolean(chrome.tabs && chrome.tabs.group && chrome.tabGroups);
}

async function hasOffscreenDocument() {
  if (!supportsOffscreen() || !chrome.offscreen.hasDocument) return false;
  try {
    return await chrome.offscreen.hasDocument();
  } catch {
    return false;
  }
}

async function ensureOffscreenDocument() {
  if (!supportsOffscreen()) return false;
  const exists = await hasOffscreenDocument();
  if (exists) return true;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["DOM_PARSER"],
      justification: "Keep a high-precision timer for auto-loading lazy tabs."
    });
    return true;
  } catch {
    return false;
  }
}

async function closeOffscreenDocument() {
  if (!supportsOffscreen() || !chrome.offscreen.closeDocument) return;
  const exists = await hasOffscreenDocument();
  if (!exists) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Ignore close errors.
  }
}

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
    STORAGE_KEYS.autoLoadIntervalMinutes,
    STORAGE_KEYS.groupLazyTabsEnabled
  ]);

  const enabled =
    typeof result[STORAGE_KEYS.enabled] === "boolean"
      ? result[STORAGE_KEYS.enabled]
      : DEFAULT_SETTINGS.enabled;

  const autoLoadEnabled =
    typeof result[STORAGE_KEYS.autoLoadEnabled] === "boolean"
      ? result[STORAGE_KEYS.autoLoadEnabled]
      : DEFAULT_SETTINGS.autoLoadEnabled;

  const groupLazyTabsEnabled =
    typeof result[STORAGE_KEYS.groupLazyTabsEnabled] === "boolean"
      ? result[STORAGE_KEYS.groupLazyTabsEnabled]
      : DEFAULT_SETTINGS.groupLazyTabsEnabled;

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

  return {
    enabled,
    autoLoadEnabled,
    autoLoadIntervalSeconds,
    groupLazyTabsEnabled
  };
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
    STORAGE_KEYS.blockedDomains,
    STORAGE_KEYS.groupLazyTabsEnabled
  ]);

  const updates = {};

  if (typeof result[STORAGE_KEYS.enabled] !== "boolean") {
    updates[STORAGE_KEYS.enabled] = DEFAULT_SETTINGS.enabled;
  }
  if (typeof result[STORAGE_KEYS.autoLoadEnabled] !== "boolean") {
    updates[STORAGE_KEYS.autoLoadEnabled] = DEFAULT_SETTINGS.autoLoadEnabled;
  }
  if (typeof result[STORAGE_KEYS.groupLazyTabsEnabled] !== "boolean") {
    updates[STORAGE_KEYS.groupLazyTabsEnabled] =
      DEFAULT_SETTINGS.groupLazyTabsEnabled;
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
      id: MENU_IDS.convertTab,
      title: "Convert tab to lazy",
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: MENU_IDS.openLazyLink,
      title: "Open in new lazy tab",
      contexts: ["link"]
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

async function getLazyGroupId(windowId) {
  if (!supportsTabGroups()) return null;

  const cached = lazyGroupByWindow.get(windowId);
  if (typeof cached === "number") {
    const group = await getTabGroup(cached);
    if (group && group.windowId === windowId) {
      return cached;
    }
    lazyGroupByWindow.delete(windowId);
  }

  const groups = await queryTabGroups({ windowId });
  const match = groups.find((group) => group.title === LAZY_GROUP_TITLE);
  if (match) {
    lazyGroupByWindow.set(windowId, match.id);
    return match.id;
  }

  return null;
}

async function ensureLazyGroupForTab(tab) {
  if (!supportsTabGroups() || !tab || typeof tab.windowId !== "number") return;

  let groupId = await getLazyGroupId(tab.windowId);
  if (typeof groupId === "number") {
    const result = await groupTab(tab.id, groupId);
    if (typeof result === "number") return;
    lazyGroupByWindow.delete(tab.windowId);
  }

  groupId = await groupTab(tab.id, null, tab.windowId);
  if (typeof groupId === "number") {
    await updateTabGroup(groupId, {
      title: LAZY_GROUP_TITLE,
      color: LAZY_GROUP_COLOR
    });
    lazyGroupByWindow.set(tab.windowId, groupId);
  }
}

async function ungroupLazyTab(tabId) {
  if (!supportsTabGroups() || typeof tabId !== "number") return;
  try {
    await ungroupTab(tabId);
  } catch {
    // Ignore ungroup errors.
  }
}

async function groupExistingLazyTabs() {
  if (!supportsTabGroups()) return;
  const tabs = await queryTabs({});
  for (const tab of tabs) {
    if (tab && isCustomTabUrl(tab.url)) {
      await ensureLazyGroupForTab(tab);
    }
  }
}

async function ungroupExistingLazyTabs() {
  if (!supportsTabGroups()) return;
  const tabs = await queryTabs({});
  for (const tab of tabs) {
    if (tab && isCustomTabUrl(tab.url)) {
      await ungroupLazyTab(tab.id);
    }
  }
  lazyGroupByWindow.clear();
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

async function clearAutoLoadSchedule() {
  await clearAlarm(AUTOLOAD_ALARM);
  await setNextAlarmAt(null);
  await closeOffscreenDocument();
}

async function ensureAutoLoadAlarm(forceReschedule = false) {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoLoadEnabled) {
    await clearAutoLoadSchedule();
    return;
  }

  const queue = await getLazyQueue();
  if (queue.length === 0) {
    await clearAutoLoadSchedule();
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

async function scheduleAutoLoad(forceReschedule = false) {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoLoadEnabled) {
    await clearAutoLoadSchedule();
    return;
  }

  const queue = await getLazyQueue();
  if (queue.length === 0) {
    await clearAutoLoadSchedule();
    return;
  }

  const usingOffscreen = await ensureOffscreenDocument();
  if (!usingOffscreen) {
    await ensureAutoLoadAlarm(forceReschedule);
    return;
  }

  await clearAlarm(AUTOLOAD_ALARM);

  if (forceReschedule) {
    const when = Date.now() + settings.autoLoadIntervalSeconds * 1000;
    await setNextAlarmAt(when);
    return;
  }

  const nextAt = await getNextAlarmAt();
  if (!nextAt || nextAt < Date.now() - 1000) {
    const when = Date.now() + settings.autoLoadIntervalSeconds * 1000;
    await setNextAlarmAt(when);
  }
}

async function clearScheduleIfQueueEmpty() {
  const queue = await getLazyQueue();
  if (queue.length === 0) {
    await clearAutoLoadSchedule();
  }
}

async function releaseAllLazyTabs() {
  const tabs = await queryTabs({});
  for (const tab of tabs) {
    if (!tab || !isCustomTabUrl(tab.url)) continue;
    const originalUrl = getOriginalUrlFromCustomTab(tab.url);
    if (originalUrl) {
      await updateTab(tab.id, { url: originalUrl });
      await ungroupLazyTab(tab.id);
    }
  }
  lazyGroupByWindow.clear();
  await setLazyQueue([]);
}

async function loadNextLazyTabNow() {
  const tab = await popNextLazyTab();
  if (!tab) {
    await clearAutoLoadSchedule();
    return false;
  }

  const originalUrl = getOriginalUrlFromCustomTab(tab.url);
  if (originalUrl) {
    await updateTab(tab.id, { url: originalUrl });
    await ungroupLazyTab(tab.id);
  }

  await scheduleAutoLoad(true);
  return true;
}

async function openLazyTabForUrl(url, openerTabId, active, options = {}) {
  const settings = await getSettings();
  const isLazyUrl = isLazyCandidateUrl(url);
  const forceLazy = options && options.forceLazy === true;

  if (!isLazyUrl) {
    return createTab({ url, openerTabId, active });
  }

  if (!forceLazy && !settings.enabled) {
    return createTab({ url, openerTabId, active });
  }

  if (await shouldBlockUrl(url)) {
    return createTab({ url, openerTabId, active });
  }

  const customTabUrl = buildCustomTabUrl(url);
  const tab = await createTab({ url: customTabUrl, openerTabId, active });

  if (tab && settings.autoLoadEnabled) {
    await enqueueLazyTab(tab.id);
    await scheduleAutoLoad(false);
  }

  if (tab && settings.groupLazyTabsEnabled) {
    await ensureLazyGroupForTab(tab);
  }

  return tab;
}

async function handlePrecisionTick() {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoLoadEnabled) {
    await clearAutoLoadSchedule();
    return;
  }

  const queue = await getLazyQueue();
  if (queue.length === 0) {
    await clearAutoLoadSchedule();
    return;
  }

  let nextAt = await getNextAlarmAt();
  const now = Date.now();

  if (!nextAt) {
    await setNextAlarmAt(now + settings.autoLoadIntervalSeconds * 1000);
    return;
  }

  if (now < nextAt) {
    return;
  }

  const tab = await popNextLazyTab();
  if (!tab) {
    await clearAutoLoadSchedule();
    return;
  }

  const originalUrl = getOriginalUrlFromCustomTab(tab.url);
  if (originalUrl) {
    await updateTab(tab.id, { url: originalUrl });
    await ungroupLazyTab(tab.id);
  }

  const remainingQueue = await getLazyQueue();
  if (remainingQueue.length === 0) {
    await clearAutoLoadSchedule();
    return;
  }

  await setNextAlarmAt(Date.now() + settings.autoLoadIntervalSeconds * 1000);
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults();
  setupContextMenus();
  scheduleAutoLoad(true);
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  setupContextMenus();
  const settings = await getSettings();
  if (settings.enabled && settings.autoLoadEnabled) {
    await rebuildQueueFromTabs();
  }
  if (settings.groupLazyTabsEnabled) {
    await groupExistingLazyTabs();
  }
  await scheduleAutoLoad(true);
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

  if (message.type === "precisionTick") {
    handlePrecisionTick();
    return;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_lazy_tab") return;
  const tab = await getActiveTabInWindow();
  if (!tab || !tab.url) return;

  let targetUrl = tab.url;
  if (isCustomTabUrl(targetUrl)) {
    targetUrl = getOriginalUrlFromCustomTab(targetUrl) || targetUrl;
  }

  if (!isLazyCandidateUrl(targetUrl)) return;

  await openLazyTabForUrl(targetUrl, tab.id, false, { forceLazy: true });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info || !info.menuItemId) return;

  if (info.menuItemId === MENU_IDS.openLazyLink) {
    if (!info.linkUrl) return;
    const openerTabId = tab && typeof tab.id === "number" ? tab.id : undefined;
    await openLazyTabForUrl(info.linkUrl, openerTabId, false, { forceLazy: true });
    return;
  }

  if (info.menuItemId === MENU_IDS.convertTab) {
    if (!tab || !tab.url) return;
    if (!isLazyCandidateUrl(tab.url)) return;
    if (isCustomTabUrl(tab.url)) return;

    const settings = await getSettings();
    if (await shouldBlockUrl(tab.url)) {
      return;
    }

    const customTabUrl = buildCustomTabUrl(tab.url);
    await updateTab(tab.id, { url: customTabUrl });

    if (settings.autoLoadEnabled) {
      await enqueueLazyTab(tab.id);
      await scheduleAutoLoad(false);
    }

    if (settings.groupLazyTabsEnabled) {
      await ensureLazyGroupForTab(tab);
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
    await scheduleAutoLoad(false);
  }

  if (settings.groupLazyTabsEnabled) {
    await ensureLazyGroupForTab(tab);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await getTab(activeInfo.tabId);
  if (!tab || !isCustomTabUrl(tab.url)) return;

  const originalUrl = getOriginalUrlFromCustomTab(tab.url);
  if (originalUrl) {
    await updateTab(activeInfo.tabId, { url: originalUrl });
    await ungroupLazyTab(activeInfo.tabId);
  }
  await removeLazyTab(activeInfo.tabId);
  await clearScheduleIfQueueEmpty();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeLazyTab(tabId);
  await clearScheduleIfQueueEmpty();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.enabled && changes.enabled.newValue === false) {
    await clearAutoLoadSchedule();
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
    await scheduleAutoLoad(true);
  }

  if (changes.groupLazyTabsEnabled) {
    if (changes.groupLazyTabsEnabled.newValue === true) {
      await groupExistingLazyTabs();
    } else {
      await ungroupExistingLazyTabs();
    }
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTOLOAD_ALARM) return;
  if (await hasOffscreenDocument()) {
    return;
  }

  const settings = await getSettings();
  if (!settings.enabled || !settings.autoLoadEnabled) {
    await clearAutoLoadSchedule();
    return;
  }

  const tab = await popNextLazyTab();
  if (!tab) {
    await clearAutoLoadSchedule();
    return;
  }

  const originalUrl = getOriginalUrlFromCustomTab(tab.url);
  if (originalUrl) {
    await updateTab(tab.id, { url: originalUrl });
    await ungroupLazyTab(tab.id);
  }

  await scheduleAutoLoad(true);
});

(async () => {
  await ensureDefaults();
  const settings = await getSettings();
  if (settings.enabled && settings.autoLoadEnabled) {
    await rebuildQueueFromTabs();
  }
  if (settings.groupLazyTabsEnabled) {
    await groupExistingLazyTabs();
  }
  await scheduleAutoLoad(true);
})();
