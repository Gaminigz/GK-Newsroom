// Screens 7 + 10 · the wait for Level 2 / Level 3 now happen inline on the conversation screen
// (#/c/:pairId, screens/conversation.js): replies sit under each line, the wait is a slim countdown banner.
// This old address only takes you there.
import { screen, go } from '../core.js';

screen('/wait/:pairId/:level', ({ params }) => {
  go(`/c/${encodeURIComponent(params.pairId)}`, { replace: true });
});
