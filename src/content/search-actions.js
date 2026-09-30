// Self-contained for chrome.scripting.executeScript and the standalone userscript.
export async function submitBingSearch(query) {
  if (query == null || (typeof query === "string" && !query.trim())) {
    throw new Error("SEARCH_QUERY_REQUIRED");
  }
  if (typeof query !== "string" || query.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(query.trim())) {
    throw new Error("SEARCH_QUERY_INVALID");
  }
  const queryText = query.trim();
  const pageUrl = () => {
    try {
      const url = new URL(location.href);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
          (url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"))) return url;
    } catch {
      // Report the same stable code for an absent or malformed page URL.
    }
    throw new Error("SEARCH_PAGE_UNSUPPORTED");
  };
  pageUrl();
  const view = document.defaultView || globalThis;
  const Form = view.HTMLFormElement;
  const Input = view.HTMLInputElement;
  const Textarea = view.HTMLTextAreaElement;
  const EventType = view.Event;
  const usable = (field) => {
    if (!((Input && field instanceof Input) || (Textarea && field instanceof Textarea)) ||
        !Form || !(field.form instanceof Form) || field.name !== "q" ||
        field.disabled || field.readOnly || field.hidden || field.matches(":disabled") ||
        field.hasAttribute("disabled") || field.getAttribute("aria-disabled") === "true" ||
        field.closest('[hidden], [aria-hidden="true"]') || field.getClientRects().length === 0) return false;
    const style = view.getComputedStyle(field);
    return style.display !== "none" && !["hidden", "collapse"].includes(style.visibility) && style.opacity !== "0";
  };
  const validateForm = (form) => {
    const currentUrl = pageUrl();
    try {
      const action = new URL(form.action, currentUrl.href);
      if (action.origin === currentUrl.origin && !action.username && !action.password &&
          /^\/search\/?$/i.test(action.pathname) && String(form.method).toLowerCase() === "get") return;
    } catch {
      // A malformed action must not receive the query either.
    }
    throw new Error("SEARCH_FORM_UNSAFE");
  };

  let field = null;
  for (let attempt = 0; attempt <= 100; attempt += 1) {
    pageUrl();
    field = Array.from(document.querySelectorAll('#sb_form_q, input[name="q"], textarea[name="q"]')).find(usable);
    if (field) break;
    if (attempt < 100) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!field) throw new Error("SEARCH_FORM_UNAVAILABLE");
  const form = field.form;
  validateForm(form);
  const prototype = field instanceof Input ? Input.prototype : Textarea.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("SEARCH_FORM_UNAVAILABLE");

  try {
    setter.call(field, queryText);
    field.dispatchEvent(new EventType("input", { bubbles: true }));
    field.dispatchEvent(new EventType("change", { bubbles: true }));
    validateForm(form);
    if (!usable(field) || field.form !== form) throw new Error("SEARCH_FORM_UNAVAILABLE");
    if (!form.checkValidity()) throw new Error("SEARCH_FORM_INVALID");
    form.setAttribute("target", "_self");
    if (typeof Form.prototype.requestSubmit === "function") {
      Form.prototype.requestSubmit.call(form);
    } else {
      const event = new EventType("submit", { bubbles: true, cancelable: true });
      if (!form.dispatchEvent(event)) throw new Error("SEARCH_SUBMIT_CANCELLED");
      validateForm(form);
      Form.prototype.submit.call(form);
    }
  } catch (error) {
    if (/^SEARCH_(?:PAGE_UNSUPPORTED|FORM_UNSAFE|FORM_UNAVAILABLE|FORM_INVALID|SUBMIT_CANCELLED)$/.test(error?.message)) {
      throw error;
    }
    throw new Error("SEARCH_SUBMIT_FAILED");
  }
  // This reports a submission attempt; Rewards progress is verified by the caller.
  return { submitted: true };
}

// Probe first so callers can persist navigation state before clicking the link.
// Keep this function self-contained for executeScript and the userscript.
export function activateSearchStreakLink(activate = false) {
  const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const view = document.defaultView || globalThis;
  const visible = element => {
    if (element.hidden || element.closest?.('[hidden], [aria-hidden="true"]') ||
        (element.getClientRects && element.getClientRects().length === 0)) return false;
    const style = view.getComputedStyle?.(element);
    return !style || (style.display !== "none" &&
      !["hidden", "collapse"].includes(style.visibility) && style.opacity !== "0");
  };
  const dialogs = Array.from(document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]'))
    .filter(dialog => {
      if (!visible(dialog)) return false;
      const labelledBy = normalize(dialog.getAttribute("aria-labelledby"));
      const title = labelledBy
        ? normalize(labelledBy.split(" ").map(id => document.getElementById(id)?.textContent).join(" "))
        : normalize(dialog.getAttribute("aria-label") || dialog.querySelector("h1, h2, h3")?.textContent);
      return /^(?:(?:必[应應]|bing)\s*(?:搜索|搜尋)\s*(?:连续|連續)\s*(?:打卡|签到|簽到)|bing\s+search\s+streak)$/i.test(title);
    });
  if (dialogs.length > 1) throw new Error("SEARCH_STREAK_LINK_NOT_UNIQUE");
  if (dialogs.length === 0) return null;
  const links = Array.from(dialogs[0].querySelectorAll("a[href]")).filter(link =>
    visible(link) && !link.disabled && !link.hasAttribute("disabled") &&
    link.getAttribute("aria-disabled") !== "true" &&
    /^(?:立即搜索|立即搜尋|search\s+now)$/i.test(normalize(link.innerText || link.textContent || link.getAttribute("aria-label"))),
  );
  if (links.length > 1) throw new Error("SEARCH_STREAK_LINK_NOT_UNIQUE");
  if (links.length === 0) return null;
  const link = links[0];
  let url;
  try {
    url = new URL(link.href || link.getAttribute("href"), location.href);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !(url.hostname === "bing.com" || url.hostname.endsWith(".bing.com"))) throw new Error();
  } catch {
    throw new Error("SEARCH_STREAK_LINK_UNSAFE");
  }
  if (activate) {
    link.setAttribute("target", "_self");
    link.click();
  }
  return { url: url.href, activated: Boolean(activate) };
}
