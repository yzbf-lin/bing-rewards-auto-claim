export function collectRewardsEntries() {
  const sectionNames = ["连续打卡任务", "升级活动", "任务", "日常任务"];
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const headings = Array.from(document.querySelectorAll("h2"));
  const groups = Array.from(document.querySelectorAll('[role="group"]'));
  const entries = [];
  const missingSections = [];
  const completedFromPageState = (value) => {
    const progressValues = [...value.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
      .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
      .filter(({ current, total }) => Number.isFinite(current) && Number.isFinite(total) && total > 0);
    const hasIncompleteProgress = progressValues.some(({ current, total }) => current < total);
    const allProgressComplete = progressValues.length > 0 &&
      progressValues.every(({ current, total }) => current >= total);
    return allProgressComplete ||
      (/已完成|已领取|completed|claimed/i.test(value) && !hasIncompleteProgress);
  };

  const groupName = (group) => {
    const directLabel = normalize(group.getAttribute("aria-label"));
    if (directLabel) return directLabel;

    const labelledBy = normalize(group.getAttribute("aria-labelledby"));
    if (!labelledBy) return "";
    return normalize(
      labelledBy
        .split(" ")
        .map((id) => {
          const labelElement = document.getElementById(id);
          return (
            labelElement?.getAttribute?.("aria-label") ||
            labelElement?.getAttribute?.("title") ||
            labelElement?.innerText ||
            labelElement?.textContent
          );
        })
        .filter(Boolean)
        .join(" "),
    );
  };

  const isTopLevelCard = (element, group) => {
    let parent = element.parentElement;
    while (parent && parent !== group) {
      if (parent.matches?.("a[href], button")) return false;
      parent = parent.parentElement;
    }
    return parent === group;
  };

  sectionNames.forEach((section, sectionIndex) => {
    const heading = headings.find((item) => normalize(item.textContent) === section);
    const group = groups.find((item) => groupName(item) === section);

    if (!heading || !group) {
      missingSections.push(section);
      return;
    }

    const cards = Array.from(group.querySelectorAll("a[href], button")).filter((item) =>
      isTopLevelCard(item, group),
    );

    cards.forEach((element, cardIndex) => {
      const id = `reward-entry-${sectionIndex}-${cardIndex}`;
      const text = normalize(element.innerText || element.textContent);
      const imageTitle = normalize(element.querySelector("img[alt]")?.getAttribute("alt"));
      const paragraphTitle = normalize(element.querySelector("p")?.textContent);
      const ariaTitle = normalize(element.getAttribute("aria-label"));
      const title = imageTitle || paragraphTitle || ariaTitle || text.slice(0, 80) || "未命名入口";
      const restrictionText = /需要.+级别|等级不足|level required/i.test(text);
      const url = element.tagName === "A" ? element.href || element.getAttribute("href") : null;
      const paragraphTexts = Array.from(element.querySelectorAll("p"))
        .map((paragraph) => normalize(paragraph.textContent));
      const disabled = Boolean(
        element.disabled ||
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" ||
          restrictionText,
      );

      element.setAttribute("data-rewards-auto-id", id);
      entries.push({
        id,
        section,
        title,
        text,
        kind: element.tagName === "A" ? "link" : "button",
        url,
        disabled,
        signals: {
          opensNewTab: element.getAttribute("target") === "_blank",
          hasProgress: /\d+\s*\/\s*\d+/.test(text),
          hasRewardBadge: paragraphTexts.some((value) => /^\+\s*[\d,]+/.test(value)),
          clickOnlyCue:
            /(?:点击|打开|访问).{0,12}(?:即可)?(?:完成|获得|领取|查看)/i.test(text) ||
            /[?&]rnoreward=1(?:&|$)/i.test(url ?? ""),
          completed: completedFromPageState(text),
        },
      });
    });
  });

  return { entries, missingSections };
}

export function collectDashboardEntries() {
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const elements = Array.from(document.querySelectorAll("a[href], button"));
  const entries = [];
  const completedFromPageState = (value) => {
    const progressValues = [...value.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
      .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
      .filter(({ current, total }) => Number.isFinite(current) && Number.isFinite(total) && total > 0);
    const hasIncompleteProgress = progressValues.some(({ current, total }) => current < total);
    const allProgressComplete = progressValues.length > 0 &&
      progressValues.every(({ current, total }) => current >= total);
    return allProgressComplete ||
      (/已完成|已领取|completed|claimed/i.test(value) && !hasIncompleteProgress);
  };

  const groupName = (group) => {
    if (!group) return "";
    const directLabel = normalize(group.getAttribute("aria-label"));
    if (directLabel) return directLabel;

    const labelledBy = normalize(group.getAttribute("aria-labelledby"));
    if (!labelledBy) return "";
    return normalize(
      labelledBy
        .split(" ")
        .map((id) => {
          const labelElement = document.getElementById(id);
          return (
            labelElement?.getAttribute?.("aria-label") ||
            labelElement?.getAttribute?.("title") ||
            labelElement?.innerText ||
            labelElement?.textContent
          );
        })
        .filter(Boolean)
        .join(" "),
    );
  };

  elements.forEach((element) => {
    const text = normalize(element.innerText || element.textContent);
    const group = element.closest?.('[role="group"]');
    const section = groupName(group) || "积分首页";
    const claimMatch = element.tagName === "BUTTON"
      ? text.match(/可领取(?:\s+可领取)?\s+([\d,]+)\s+领取/i)
      : null;
    const claimablePoints = claimMatch ? Number(claimMatch[1].replaceAll(",", "")) : 0;
    const dailyRewardPoints = section === "每日活动"
      ? Array.from(element.querySelectorAll("p"))
        .map((paragraph) => normalize(paragraph.textContent))
        .reverse()
        .map((value) => value.match(/^\+?\s*([\d,]{1,9})(?:\s*(?:积分|points?))?$/i))
        .find(Boolean)
      : null;
    const detectedRewardPoints = claimablePoints > 0
      ? claimablePoints
      : dailyRewardPoints
        ? Number(dailyRewardPoints[1].replaceAll(",", ""))
        : null;
    const explicitReward = /\+\s*[\d,]{1,9}(?:\s*(?:积分|points?))?/i.test(text);
    if (!explicitReward && detectedRewardPoints === null) return;

    const id = `dashboard-entry-${entries.length}`;
    const imageTitle = normalize(element.querySelector("img[alt]")?.getAttribute("alt"));
    const paragraphTitle = normalize(element.querySelector("p")?.textContent);
    const ariaTitle = normalize(element.getAttribute("aria-label"));
    const title = claimablePoints > 0
      ? "领取待领取积分"
      : imageTitle || paragraphTitle || ariaTitle || text.slice(0, 80) || "未命名入口";
    const restrictionText = /需要.+级别|等级不足|level required/i.test(text);
    const disabled = Boolean(
      element.disabled ||
        element.hasAttribute("disabled") ||
        element.getAttribute("aria-disabled") === "true" ||
        restrictionText,
    );

    element.setAttribute("data-rewards-auto-id", id);
    if (claimablePoints > 0) {
      element.setAttribute("data-rewards-auto-action", "claim-points");
    }
    entries.push({
      id,
      section: claimablePoints > 0 ? "待领取积分" : section,
      title,
      text,
      kind: element.tagName === "A" ? "link" : "button",
      url: element.tagName === "A" ? element.href || element.getAttribute("href") : null,
      disabled,
      action: claimablePoints > 0 ? "claim-points" : null,
      rewardPoints: detectedRewardPoints,
      signals: {
        opensNewTab: element.getAttribute("target") === "_blank",
        hasProgress: /\d+\s*\/\s*\d+/.test(text),
        hasRewardBadge: explicitReward || detectedRewardPoints !== null,
        clickOnlyCue:
          /(?:点击|打开|访问).{0,12}(?:即可)?(?:完成|获得|领取|查看)/i.test(text) ||
          /[?&]rnoreward=1(?:&|$)/i.test(element.href ?? ""),
        completed: completedFromPageState(text),
      },
    });
  });

  return { entries, missingSections: [] };
}

export function collectQuestEntries(parentTitle) {
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const completedFromPageState = (value) => {
    const progressValues = [...value.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
      .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
      .filter(({ current, total }) => Number.isFinite(current) && Number.isFinite(total) && total > 0);
    const hasIncompleteProgress = progressValues.some(({ current, total }) => current < total);
    const allProgressComplete = progressValues.length > 0 &&
      progressValues.every(({ current, total }) => current >= total);
    return allProgressComplete ||
      (/已完成|已领取|completed|claimed/i.test(value) && !hasIncompleteProgress);
  };
  const main = document.querySelector("main");
  if (!main) return { entries: [], missingSections: [`任务子步骤：${parentTitle}`] };

  const entries = [];
  const links = Array.from(main.querySelectorAll("a[href]"));

  links.forEach((element) => {
    const url = element.href || element.getAttribute("href");
    let trustedTaskLink = false;
    try {
      const parsed = new URL(url, location.href);
      trustedTaskLink = parsed.protocol === "https:" &&
        (parsed.hostname === "bing.com" || parsed.hostname.endsWith(".bing.com")) &&
        !/^\/earn\/?$/i.test(parsed.pathname);
    } catch {
      trustedTaskLink = false;
    }
    if (!trustedTaskLink) return;

    const text = normalize(element.innerText || element.textContent);
    const ariaTitle = normalize(element.getAttribute("aria-label"));
    const title = text || ariaTitle || `任务子步骤 ${entries.length + 1}`;
    const disabled = Boolean(
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.getAttribute("data-disabled") === "true",
    );
    const id = `quest-entry-${entries.length}`;

    element.setAttribute("data-rewards-auto-id", id);
    entries.push({
      id,
      section: `任务：${parentTitle}`,
      parentTitle,
      title,
      text: ariaTitle || text,
      kind: "link",
      url,
      disabled,
      action: "quest-step",
      signals: {
        opensNewTab: element.getAttribute("target") === "_blank",
        hasProgress: /\d+\s*\/\s*\d+/.test(ariaTitle || text),
        hasRewardBadge: false,
        clickOnlyCue:
          /(?:点击|打开|访问).{0,12}(?:即可)?(?:完成|获得|领取|查看)/i.test(ariaTitle || text) ||
          /[?&]rnoreward=1(?:&|$)/i.test(url),
        completed: completedFromPageState(ariaTitle || text),
      },
    });
  });

  return { entries, missingSections: [] };
}

export async function activateRewardsButton(entryId) {
  const element = document.querySelector(`[data-rewards-auto-id="${entryId}"]`);
  if (!element || element.tagName !== "BUTTON") return false;
  const action = element.getAttribute("data-rewards-auto-action");
  element.click();

  if (action === "claim-points") {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const confirmButton = Array.from(document.querySelectorAll("button")).find((button) => {
        const text = String(button.innerText || button.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        return text === "领取积分" && Boolean(button.closest?.('[role="dialog"]'));
      });
      if (confirmButton) {
        confirmButton.click();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  return true;
}
