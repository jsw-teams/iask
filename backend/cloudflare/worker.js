// Cloudflare-specific entry. Existing Durable Object class/name is retained for upgrades.
import {fetchService} from '../handler.js';
export {CommentCoordinator} from '../index.js';
export default {fetch:fetchService};
