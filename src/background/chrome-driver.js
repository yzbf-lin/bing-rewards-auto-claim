import {
  activateRewardsLink,
  activateRewardsButton,
  collectDashboardEntries,
  collectQuestEntries,
  collectRewardsEntries,
} from "../content/page-actions.js";
import { solveImagePuzzle } from "../content/image-puzzle.js";
import { submitBingSearch } from "../content/search-actions.js";
import { getSearchStreakProgress } from "../shared/search-streak.js";
import { analyzeEntryFeatures } from "../shared/task-policy.js";

const REWARDS_URL = "https://rewards.bing.com/earn";
const DASHBOARD_URL = "https://rewards.bing.com/dashboard";
const CATALOG_SOURCES = [
  { key: "earn", url: REWARDS_URL, collector: collectRewardsEntries },
  { key: "dashboard", url: DASHBOARD_URL, collector: collectDashboardEntries },
];

function canScriptRewardsPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"));
  } catch {
    return false;
  }
}

function catalogSignature(catalog) {
  return JSON.stringify({
    missingSections: catalog.missingSections,
    progress: catalog.progress ?? null,
    claimablePoints: catalog.claimablePoints ?? null,
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

  const executeRewardsScript = async (options) => {
    const tab = await chromeApi.tabs.get(options.target.tabId);
    if (!canScriptRewardsPage(tab.url) ||
        (tab.pendingUrl && !canScriptRewardsPage(tab.pendingUrl))) {
      throw new Error("SCRIPTING_PAGE_UNSUPPORTED");
    }
    try {
      return await chromeApi.scripting.executeScript(options);
    } catch (error) {
      // The user can navigate away between the URL check and browser injection.
      if (error?.message?.includes("The extensions gallery cannot be scripted")) {
        throw new Error("SCRIPTING_PAGE_UNSUPPORTED");
      }
      throw error;
    }
  };

  const ensureProgressOverlay = async (tabId) => {
    try {
      await executeRewardsScript({
        target: { tabId },
        files: ["src/content/floating-widget.js", "src/content/progress-overlay.js"],
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

  const waitForTabLoaded = (tabId, { previousUrl, navigate } = {}) => new Promise((resolve, reject) => {
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
      if (updatedTabId === tabId && changeInfo.status === "complete" && !tab.pendingUrl) finish(resolve, tab);
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(reject, new Error("TAB_CLOSED"));
    };

    chromeApi.tabs.onUpdated.addListener(onUpdated);
    chromeApi.tabs.onRemoved.addListener(onRemoved);
    Promise.resolve()
      .then(async () => {
        // Listen before navigating so a fast redirect cannot complete unnoticed.
        if (navigate) await navigate();
        if (settled) return;
        const tab = await chromeApi.tabs.get(tabId);
        // tabs.update can resolve while tabs.get still describes the old document.
        if (tab.status === "complete" && !tab.pendingUrl &&
            (!previousUrl || tab.url !== previousUrl)) finish(resolve, tab);
      })
      .catch((error) => finish(reject, error));
  });

  const navigateExistingTab = async (tabId, url, active = true) => {
    const currentTab = await chromeApi.tabs.get(tabId);
    if (currentTab.url === url && !currentTab.pendingUrl) {
      const loadedTab = currentTab.status === "complete"
        ? currentTab
        : waitForTabLoaded(tabId);
      const result = await loadedTab;
      if (active) await ensureProgressOverlay(tabId);
      return result;
    }

    const loadedTab = await waitForTabLoaded(tabId, {
      previousUrl: currentTab.url === url ? undefined : currentTab.url,
      navigate: () => chromeApi.tabs.update(tabId, { url, active }),
    });
    if (active) await ensureProgressOverlay(tabId);
    return loadedTab;
  };

  const collectOnce = async (tabId, collector, args = []) => {
    const results = await executeRewardsScript({
      target: { tabId },
      func: collector,
      args,
    });
    const catalog = results?.[0]?.result;
    if (!catalog || !Array.isArray(catalog.entries)) throw new Error("CATALOG_UNAVAILABLE");
    return catalog;
  };

  const collectStableCatalog = async (tabId, collector, args = [], requireClaimBalance = false) => {
    let previousSignature = null;
    let latest = null;

    for (let attempt = 0; attempt < catalogAttempts; attempt += 1) {
      latest = await collectOnce(tabId, collector, args);
      const signature = catalogSignature(latest);
      const ready = !requireClaimBalance || typeof latest.claimablePoints === "number";
      if (ready && latest.missingSections.length === 0 && signature === previousSignature) return latest;
      previousSignature = signature;
      if (attempt < catalogAttempts - 1) await delay(500);
    }

    if (!latest) throw new Error("CATALOG_UNAVAILABLE");
    if (requireClaimBalance && typeof latest.claimablePoints !== "number") {
      throw new Error("CLAIM_BALANCE_UNAVAILABLE");
    }
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

    async refreshDashboard({ targetTabId } = {}) {
      const tab = targetTabId
        ? await navigateExistingTab(targetTabId, DASHBOARD_URL)
        : await createTab(DASHBOARD_URL);
      try {
        if (!targetTabId) await waitForTabLoaded(tab.id);
        await delay(settleDelayMs);
        const catalog = await collectStableCatalog(tab.id, collectDashboardEntries, [], true);
        return {
          ...catalog,
          entries: catalog.entries.map((entry) => ({ ...entry, source: "dashboard", sourceUrl: DASHBOARD_URL })),
        };
      } finally {
        if (!targetTabId) await removeTab(tab.id);
      }
    },

    async executeLink(entry, { targetTabId, searchQuery } = {}) {
      const searchStreak = getSearchStreakProgress(entry);
      if (searchStreak && (typeof searchQuery !== "string" || !searchQuery.trim())) {
        throw new Error("SEARCH_QUERY_REQUIRED");
      }
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
          (searchStreak || candidate.text === entry.text) &&
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
        if (searchStreak) {
          const currentEntry = matches[0];
          if (currentEntry.disabled) throw new Error("SEARCH_STREAK_UNAVAILABLE");
          const currentProgress = getSearchStreakProgress(currentEntry);
          if (!currentProgress) throw new Error("SEARCH_STREAK_NOT_CONFIRMED");
          if (currentProgress.current >= currentProgress.total) {
            return { finalUrl: sourceUrl, reason: "SEARCH_STREAK_COMPLETED" };
          }
          if (currentEntry.signals?.completed === true) throw new Error("SEARCH_STREAK_NOT_CONFIRMED");
        }

        const activationSource = await chromeApi.tabs.get(sourceTab.id);
        const activation = await executeRewardsScript({
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
        const finalUrl = resultTab.url ?? activationResult.url ?? entry.url;
        if (searchStreak) {
          // The helper waits for the hydrated form and submits once. Register the
          // navigation listener first so a fast native submission is observed.
          const searchResultTab = await waitForTabLoaded(resultTab.id, {
            previousUrl: resultTab.url,
            navigate: async () => {
              const results = await executeRewardsScript({
                target: { tabId: resultTab.id },
                func: submitBingSearch,
                args: [searchQuery],
              });
              if (!results?.[0]?.result?.submitted) throw new Error("SEARCH_SUBMIT_FAILED");
            },
          });
          if (!canScriptRewardsPage(searchResultTab.url) ||
              (searchResultTab.pendingUrl && !canScriptRewardsPage(searchResultTab.pendingUrl))) {
            throw new Error("SCRIPTING_PAGE_UNSUPPORTED");
          }
          const searchResultUrl = new URL(searchResultTab.url);
          const resultQueries = searchResultUrl.searchParams.getAll("q");
          if (!/^\/search\/?$/i.test(searchResultUrl.pathname) ||
              resultQueries.length !== 1 || resultQueries[0] !== searchQuery.trim()) {
            throw new Error("SEARCH_SUBMIT_NOT_CONFIRMED");
          }
          await delay(settleDelayMs);
          await navigateExistingTab(resultTab.id, sourceUrl, Boolean(targetTabId));
          for (let attempt = 0; attempt < catalogAttempts; attempt += 1) {
            const refreshed = await collectOnce(resultTab.id, collector, collectorArgs);
            const candidates = refreshed.entries.filter(candidate =>
              candidate.section === entry.section && candidate.title === entry.title,
            );
            const progress = candidates.length === 1 ? getSearchStreakProgress(candidates[0]) : null;
            if (progress && progress.current >= progress.total) {
              return { finalUrl: sourceUrl, reason: "SEARCH_STREAK_COMPLETED" };
            }
            if (attempt < catalogAttempts - 1) await delay(500);
          }
          throw new Error("SEARCH_STREAK_NOT_CONFIRMED");
        }
        if (analyzeEntryFeatures(entry).imagePuzzle) {
          if (!analyzeEntryFeatures({ kind: "link", url: finalUrl }).imagePuzzle) {
            throw new Error("PUZZLE_PAGE_UNAVAILABLE");
          }
          const results = await executeRewardsScript({
            target: { tabId: resultTab.id },
            func: solveImagePuzzle,
          });
          const solved = results?.[0]?.result;
          if (!solved?.solved) throw new Error("PUZZLE_NOT_CONFIRMED");
          // Allow the page's native completion request to finish before closing it.
          await delay(settleDelayMs);
          return { finalUrl, reason: "PUZZLE_COMPLETED", puzzleMoves: solved.moves };
        }
        return { finalUrl };
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
        if (matches[0].disabled) throw new Error("BUTTON_DISABLED");

        const activation = await executeRewardsScript({
          target: { tabId: sourceTab.id },
          func: activateRewardsButton,
          args: [matches[0].id],
        });
        if (activation?.[0]?.result !== true) throw new Error("BUTTON_ACTIVATION_FAILED");
        await delay(settleDelayMs);

        if (entry.action === "claim-points") {
          const before = matches[0].rewardPoints;
          for (let attempt = 0; attempt < catalogAttempts; attempt += 1) {
            const after = await collectOnce(sourceTab.id, collectDashboardEntries);
            if (typeof after.claimablePoints === "number" && after.claimablePoints >= 0 &&
                after.claimablePoints < before) {
              return { finalUrl: sourceUrl, reason: "POINTS_CLAIMED", claimedPoints: before - after.claimablePoints };
            }
            if (attempt < catalogAttempts - 1) await delay(500);
          }
          throw new Error("CLAIM_NOT_CONFIRMED");
        }

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
