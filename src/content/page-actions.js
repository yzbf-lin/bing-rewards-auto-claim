export function collectRewardsEntries() {
  const sectionNames = ["连续打卡任务", "升级活动", "任务", "日常任务"];
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const headings = Array.from(document.querySelectorAll("h2"));
  const groups = Array.from(document.querySelectorAll('[role="group"]'));
  const entries = [];
  const missingSections = [];

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
        url: element.tagName === "A" ? element.href || element.getAttribute("href") : null,
        disabled,
      });
    });
  });

  return { entries, missingSections };
}

export function collectDashboardEntries() {
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const elements = Array.from(document.querySelectorAll("a[href], button"));
  const entries = [];

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
    const claimMatch = element.tagName === "BUTTON"
      ? text.match(/可领取(?:\s+可领取)?\s+([\d,]+)\s+领取/i)
      : null;
    const claimablePoints = claimMatch ? Number(claimMatch[1].replaceAll(",", "")) : 0;
    const explicitReward = /\+\s*[\d,]{1,9}(?:\s*(?:积分|points?))?/i.test(text);
    if (!explicitReward && claimablePoints <= 0) return;

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
    const group = element.closest?.('[role="group"]');
    entries.push({
      id,
      section: claimablePoints > 0 ? "待领取积分" : groupName(group) || "积分首页",
      title,
      text,
      kind: element.tagName === "A" ? "link" : "button",
      url: element.tagName === "A" ? element.href || element.getAttribute("href") : null,
      disabled,
      action: claimablePoints > 0 ? "claim-points" : null,
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
