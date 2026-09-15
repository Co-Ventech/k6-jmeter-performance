import { spikeOptions } from './config.js';
import catalogJourney from './journey.js';
import { handleSummary as writeSummary } from './summary.js';

export const options = spikeOptions();
export default catalogJourney;
export function handleSummary(data) {
  if (!__ENV.PROFILE) {
    __ENV.PROFILE = 'spike';
  }
  return writeSummary(data);
}
