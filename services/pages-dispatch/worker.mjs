/**
 * Cloudflare Worker cron that starts the Storm Watch Pages workflow on time. GitHub's own `schedule` trigger for pages.yml
 * ("every 15 minutes") ran only every 8–10 hours in November 2026, which left the published feeds stale; a workflow_dispatch
 * call from here starts it within seconds. The GitHub schedule stays in pages.yml as a fallback.
 *
 * Secret GITHUB_TOKEN: a fine-grained token for COF-RyLopez/fresno-storm-watch with "Actions: Read and write" and nothing else.
 * Deploy: cd services/pages-dispatch && npx wrangler secret put GITHUB_TOKEN && npx wrangler deploy
 */
const REPO = 'COF-RyLopez/fresno-storm-watch', WORKFLOW = 'pages.yml', REF = 'main';

export async function dispatch(env, fetchImpl = fetch) {
  if (!env.GITHUB_TOKEN) throw Error('GITHUB_TOKEN secret is not set');
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'storm-watch-pages-dispatch' },
    body: JSON.stringify({ ref: REF })
  });
  if (response.status !== 204) throw Error(`GitHub dispatch failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.status;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(dispatch(env)); },
  // No public trigger: a GET only reports that the Worker is alive, so nobody can start runs through it.
  async fetch() { return new Response('Storm Watch Pages dispatcher: runs on its cron schedule only.\n', { headers: { 'content-type': 'text/plain' } }); }
};
