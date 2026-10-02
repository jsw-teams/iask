export class GitHubCommentsError extends Error {
  constructor(response) {
    super('GitHub comments API returned ' + response.status);
    this.status = response.status;
    this.rateLimited = response.status === 429 || (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
    this.retryAfter = Math.min(3600, Math.max(1, Number.parseInt(response.headers.get('retry-after'), 10) || 60));
  }
}
