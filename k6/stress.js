import { stressOptions } from './config.js';
import catalogJourney from './journey.js';
import { handleSummary as writeSummary } from './summary.js';

export const options = stressOptions();
export default catalogJourney;
export function handleSummary(data) {
  if (!__ENV.PROFILE) {
    __ENV.PROFILE = 'stress';
  }
  return writeSummary(data);
}
