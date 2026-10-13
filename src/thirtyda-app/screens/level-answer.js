// Screens 6 + 9 · replying to the other person's 5 lines now happen inline on the conversation screen
// (#/c/:pairId, screens/conversation.js): replies sit under each line, the wait is a slim countdown banner.
// This old address only takes you there.
import { screen, go } from '../core.js';

screen('/answer/:pairId/:level', ({ params }) => {
  go(`/c/${encodeURIComponent(params.pairId)}`, { replace: true });
});
