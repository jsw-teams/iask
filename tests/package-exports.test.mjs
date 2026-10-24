import assert from 'node:assert/strict';
import {test} from 'node:test';

test('published service, platform and asset APIs support a separate operator project', async () => {
  const [service, cloudflare, netlify, vercel, assets, errors] = await Promise.all([
    import('@jsw-teams/iask/service'), import('@jsw-teams/iask/cloudflare'),
    import('@jsw-teams/iask/netlify'), import('@jsw-teams/iask/vercel'),
    import('@jsw-teams/iask/build'), import('@jsw-teams/iask/error-page'),
  ]);
  assert.equal(typeof service.fetchService, 'function');
  assert.equal(typeof cloudflare.default.fetch, 'function');
  assert.equal(typeof cloudflare.CommentCoordinator, 'function');
  assert.equal(typeof netlify.createNetlifyHandler, 'function');
  assert.equal(typeof vercel.createVercelHandler, 'function');
  assert.equal(typeof assets.copyWidgetAssets, 'function');
  assert.equal(typeof errors.writeErrorPage, 'function');
});
