const RELEASE_API_URL = "https://api.github.com/repos/yzbf-lin/bing-rewards-auto-claim/releases/latest";
const RELEASE_PATH_PREFIX = "/yzbf-lin/bing-rewards-auto-claim/";

function versionParts(version) {
  return String(version ?? "")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function trustedGitHubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith(RELEASE_PATH_PREFIX)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function fetchLatestRelease({ fetchFn = fetch, currentVersion, now = () => new Date() }) {
  const response = await fetchFn(RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GITHUB_RELEASE_HTTP_${response.status}`);

  const release = await response.json();
  const latestVersion = String(release.tag_name ?? "").replace(/^v/i, "");
  if (!latestVersion) throw new Error("GITHUB_RELEASE_VERSION_MISSING");

  const asset = (release.assets ?? []).find((candidate) =>
    /^bing-rewards-auto-claim-v.+\.zip$/i.test(candidate.name ?? "") &&
    trustedGitHubUrl(candidate.browser_download_url),
  );
  const releaseUrl = trustedGitHubUrl(release.html_url);
  if (!releaseUrl) throw new Error("GITHUB_RELEASE_URL_INVALID");

  return {
    status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "current",
    currentVersion,
    latestVersion,
    releaseUrl,
    downloadUrl: asset ? trustedGitHubUrl(asset.browser_download_url) : null,
    fileName: asset?.name ?? null,
    checkedAt: now().toISOString(),
  };
}
