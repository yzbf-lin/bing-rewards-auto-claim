import {
  activateRewardsLink,
  activateRewardsButton,
  collectDashboardEntries,
  collectQuestEntries,
  collectRewardsEntries,
} from "../content/page-actions.js";

const REWARDS_URL = "https://rewards.bing.com/earn";
const DASHBOARD_URL = "https://rewards.bing.com/dashboard?section=dailyset";
const CATALOG_SOURCES = [
  { key: "earn", url: REWARDS_URL, collector: collectRewardsEntries },
  { key: "dashboard", url: DASHBOARD_URL, collector: collectDashboardEntries },
];

function catalogSignature(catalog) {
  return JSON.stringify({
    missingSections: catalog.missingSections,
    progress: catalog.progress ?? null,
    entries: catalog.entries.map(({ id, section, title, text, kind, url, disabled, action }) => ({
      id,
      section,
      title,
      text,
      kind,
      url,
      disabled,
      action,
    })),
  });
}

export function createChromeDriver({
  chromeApi,
  timeoutMs = 20_000,
  settleDelayMs = 1_500,
  catalogAttempts = 40,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const createdTabs = new Set();

  const ensureProgressOverlay = async (tabId) => {
    try {
      await chromeApi.scripting.executeScript({
        target: { tabId },
        files: ["src/content/progress-overlay.js"],
      });
      return true;
    } catch {
      // The target may have closed or navigated to a browser-internal page.
      return false;
    }
  };

  const removeTab = async (tabId) => {
    if (!createdTabs.has(tabId)) return;
    createdTabs.delete(tabId);
    try {
      await chromeApi.tabs.remove(tabId);
    } catch {
      // The user may have already closed the temporary tab.
    }
  };

  const createTab = async (url) => {
    const tab = await chromeApi.tabs.create({ url, active: false });
    createdTabs.add(tab.id);
    return tab;
  };

  const waitForTabLoaded = (tabId) => new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => finish(reject, new Error("TAB_LOAD_TIMEOUT")), timeoutMs);

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chromeApi.tabs.onUpdated.removeListener(onUpdated);
      chromeApi.tabs.onRemoved.removeListener(onRemoved);
      callback(value);
    };
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(resolve, tab);
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(reject, new Error("TAB_CLOSED"));
    };

    chromeApi.tabs.onUpdated.addListener(onUpdated);
    chromeApi.tabs.onRemoved.addListener(onRemoved);
    chromeApi.tabs.get(tabId)
      .then((tab) => {
        if (tab.status === "complete") finish(resolve, tab);
      })
      .catch((error) => finish(reject, error));
  });

  const navigateExistingTab = async (tabId, url, active = true) => {
    const currentTab = await chromeApi.tabs.get(tabId);
    if (currentTab.url === url) {
      const loadedTab = currentTab.status === "complete"
        ? currentTab
        : waitForTabLoaded(tabId);
      const result = await loadedTab;
      if (active) await ensureProgressOverlay(tabId);
      return result;
    }

    await chromeApi.tabs.update(tabId, { url, active });
    const loadedTab = await waitForTabLoaded(tabId);
    if (active) await ensureProgressOverlay(tabId);
    return loadedTab;
  };

  const collectOnce = async (tabId, collector, args = []) => {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId },
      func: collector,
      args,
    });
    const catalog = results?.[0]?.result;
    if (!catalog || !Array.isArray(catalog.entries)) throw new Error("CATALOG_UNAVAILABLE");
    return catalog;
  };

  const collectStableCatalog = async (tabId, collector, args = []) => {
    let previousSignature = null;
    let latest = null;

    for (let attempt = 0; attempt < catalogAttempts; attempt += 1) {
      latest = await collectOnce(tabId, collector, args);
      const signature = catalogSignature(latest);
      if (latest.missingSections.length === 0 && signature === previousSignature) return latest;
      previousSignature = signature;
      if (attempt < catalogAttempts - 1) await delay(500);
    }

    if (!latest) throw new Error("CATALOG_UNAVAILABLE");
    return latest;
  };

  return {
    async showProgress({ targetTabId } = {}) {
      if (!targetTabId) return false;
      return ensureProgressOverlay(targetTabId);
    },

    async loadCatalog({ targetTabId } = {}) {
      const combined = { entries: [], missingSections: [] };

      for (const source of CATALOG_SOURCES) {
        const sourceTab = targetTabId
          ? await navigateExistingTab(targetTabId, source.url)
          : await createTab(source.url);
        try {
          if (!targetTabId) await waitForTabLoaded(sourceTab.id);
          const catalog = await collectStableCatalog(sourceTab.id, source.collector);
          combined.entries.push(
            ...catalog.entries.map((entry) => ({
              ...entry,
              source: source.key,
              sourceUrl: source.url,
            })),
          );
          combined.missingSections.push(...catalog.missingSections);

          if (source.key === "earn") {
            const questParents = catalog.entries.filter((entry) =>
              entry.kind === "link" && /\/earn\/quest\//i.test(entry.url ?? ""),
            );
            for (const quest of questParents) {
              try {
                await navigateExistingTab(sourceTab.id, quest.url, Boolean(targetTabId));
                const questCatalog = await collectStableCatalog(
                  sourceTab.id,
                  collectQuestEntries,
                  [quest.title],
                );
                combined.entries.push(
                  ...questCatalog.entries.map((entry) => ({
                    ...entry,
                    source: "quest",
                    sourceUrl: quest.url,
                    questProgress: questCatalog.progress ?? null,
                  })),
                );
                combined.missingSections.push(...questCatalog.missingSections);
              } catch {
                combined.missingSections.push(`任务子步骤：${quest.title}`);
              }
            }
          }
        } finally {
          if (!targetTabId) await removeTab(sourceTab.id);
        }
      }

      return combined;
    },

    async refreshQuest(entry, { targetTabId } = {}) {
      if (!entry.sourceUrl || !entry.parentTitle) {
        return { entries: [], missingSections: [] };
      }
      const sourceTab = targetTabId
        ? await navigateExistingTab(targetTabId, entry.sourceUrl)
        : await createTab(entry.sourceUrl);
      try {
        if (!targetTabId) await waitForTabLoaded(sourceTab.id);
        const catalog = await collectStableCatalog(
          sourceTab.id,
          collectQuestEntries,
          [entry.parentTitle],
        );
        return {
          entries: catalog.entries.map((candidate) => ({
            ...candidate,
            source: "quest",
            sourceUrl: entry.sourceUrl,
            questProgress: catalog.progress ?? null,
          })),
          missingSections: catalog.missingSections,
          progress: catalog.progress ?? null,
        };
      } finally {
        if (!targetTabId) await removeTab(sourceTab.id);
      }
    },

    async executeLink(entry, { targetTabId } = {}) {
      const sourceUrl = entry.sourceUrl ?? REWARDS_URL;
      const collector = entry.source === "dashboard"
        ? collectDashboardEntries
        : entry.source === "quest"
          ? collectQuestEntries
          : collectRewardsEntries;
      const collectorArgs = entry.source === "quest" ? [entry.parentTitle] : [];
      const sourceTab = targetTabId
        ? await navigateExistingTab(targetTabId, sourceUrl)
        : await createTab(sourceUrl);
      let openedTabId = null;
      const onCreated = (tab) => {
        if (tab.openerTabId !== sourceTab.id) return;
        openedTabId = tab.id;
        createdTabs.add(tab.id);
      };
      chromeApi.tabs.onCreated.addListener(onCreated);

      try {
        if (!targetTabId) await waitForTabLoaded(sourceTab.id);
        await delay(settleDelayMs);
        const catalog = await collectOnce(sourceTab.id, collector, collectorArgs);
        let matches = catalog.entries.filter((candidate) =>
          candidate.section === entry.section &&
          candidate.title === entry.title &&
          candidate.text === entry.text &&
          candidate.kind === "link",
        );
        if (matches.length === 0) {
          matches = catalog.entries.filter((candidate) =>
            candidate.section === entry.section &&
            candidate.title === entry.title &&
            candidate.kind === "link",
          );
        }
        if (matches.length !== 1) throw new Error("LINK_NOT_UNIQUE");

        const activationSource = await chromeApi.tabs.get(sourceTab.id);
        const activation = await chromeApi.scripting.executeScript({
          target: { tabId: sourceTab.id },
          func: activateRewardsLink,
          args: [matches[0].id],
        });
        const activationResult = activation?.[0]?.result;
        if (!activationResult?.activated) throw new Error("LINK_ACTIVATION_FAILED");
        await delay(settleDelayMs);

        let resultTab;
        if (openedTabId) {
          resultTab = await waitForTabLoaded(openedTabId);
          if (targetTabId) {
            resultTab = await navigateExistingTab(targetTabId, resultTab.url ?? activationResult.url);
          }
        } else {
          const currentTab = await chromeApi.tabs.get(sourceTab.id);
          if (currentTab.status !== "complete") {
            resultTab = await waitForTabLoaded(sourceTab.id);
          } else if (currentTab.url !== activationSource.url) {
            resultTab = currentTab;
          } else {
            resultTab = await navigateExistingTab(
              sourceTab.id,
              activationResult.url ?? entry.url,
              Boolean(targetTabId),
            );
          }
        }
        return { finalUrl: resultTab.url ?? activationResult.url ?? entry.url };
      } finally {
        chromeApi.tabs.onCreated.removeListener(onCreated);
        if (openedTabId) await removeTab(openedTabId);
        if (!targetTabId) await removeTab(sourceTab.id);
      }
    },

    async executeButton(entry, { targetTabId } = {}) {
      const sourceUrl = entry.sourceUrl ?? REWARDS_URL;
      const collector = entry.source === "dashboard"
        ? collectDashboardEntries
        : collectRewardsEntries;
      const sourceTab = targetTabId
        ? await navigateExistingTab(targetTabId, sourceUrl)
        : await createTab(sourceUrl);
      let openedTabId = null;
      const onCreated = (tab) => {
        if (tab.openerTabId !== sourceTab.id) return;
        openedTabId = tab.id;
        createdTabs.add(tab.id);
      };
      chromeApi.tabs.onCreated.addListener(onCreated);

      try {
        if (!targetTabId) await waitForTabLoaded(sourceTab.id);
        await delay(settleDelayMs);
        const catalog = await collectOnce(sourceTab.id, collector);
        let matches = catalog.entries.filter((candidate) =>
          candidate.section === entry.section &&
          candidate.title === entry.title &&
          candidate.text === entry.text &&
          candidate.kind === "button",
        );
        if (matches.length === 0) {
          matches = catalog.entries.filter((candidate) =>
            candidate.section === entry.section &&
            candidate.title === entry.title &&
            candidate.kind === "button",
          );
        }
        if (matches.length !== 1) throw new Error("BUTTON_NOT_UNIQUE");

        const activation = await chromeApi.scripting.executeScript({
          target: { tabId: sourceTab.id },
          func: activateRewardsButton,
          args: [matches[0].id],
        });
        if (activation?.[0]?.result !== true) throw new Error("BUTTON_ACTIVATION_FAILED");
        await delay(settleDelayMs);

        const resultTab = openedTabId
          ? await waitForTabLoaded(openedTabId)
          : await chromeApi.tabs.get(sourceTab.id);
        const finalUrl = resultTab.url ?? sourceUrl;
        if (targetTabId && openedTabId) {
          await navigateExistingTab(targetTabId, finalUrl);
        }
        return { finalUrl };
      } finally {
        chromeApi.tabs.onCreated.removeListener(onCreated);
        if (openedTabId) await removeTab(openedTabId);
        if (!targetTabId) await removeTab(sourceTab.id);
      }
    },

    async restore({ targetTabId } = {}) {
      if (!targetTabId) return null;
      return navigateExistingTab(targetTabId, REWARDS_URL);
    },

    async cleanup() {
      const tabIds = [...createdTabs];
      await Promise.all(tabIds.map((tabId) => removeTab(tabId)));
    },
  };
}
